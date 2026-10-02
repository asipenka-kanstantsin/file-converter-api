import { Transactional } from '@nestjs-cls/transactional';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';
import { mapPrismaException } from '@/infrastructure/database';
import { SettingsService } from '@/modules/settings';
import { type User, UsersService } from '@/modules/users';

import { ChallengesService } from './challenges.service';
import type {
  Challenge,
  ChallengePurpose,
  IssuedChallenge,
} from './challenges.types';
import type { LoginInput } from './dto/login.dto';
import type { RegisterInput } from './dto/register.dto';
import { LoginLockout } from './login-lockout';
import { PasswordHasher } from './password-hasher';
import { SessionResolver } from './session-resolver';
import { type SessionTokens, SessionTokenService } from './session-tokens';

export type RegisterResult =
  | { challenge: IssuedChallenge; kind: 'confirmation_required'; user: User }
  | { kind: 'registered'; user: User };

export type LoginResult =
  | { challenge: IssuedChallenge; kind: 'confirmation_required'; user: User }
  | { kind: 'signed_in'; session: SessionTokens; user: User };

// A confirmed sign-in carries a session; a confirmed registration does not (decision A9).
export interface ConfirmResult {
  session?: SessionTokens;
  user: User;
}

function failureReason(error: unknown): string {
  if (error instanceof AppException) return error.code;
  return mapPrismaException(error)?.code ?? 'unexpected';
}

// Audit events of Notion "Регистрация" / "Аутентификация" 1.5 are logged here, after the
// transaction committed; requests rejected before the service (validation, CSRF, rate limit) are
// logged by the filter. E-mails are never logged — user ids are.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly challenges: ChallengesService,
    private readonly config: AppConfig,
    private readonly lockout: LoginLockout,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionResolver,
    private readonly sessionTokens: SessionTokenService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
  ) {}

  // Notion "Авторизация" 1.3.2: a valid refresh token of an active account → a new pair
  // (rotation). Nothing is stored, so there is no state of the old token to check or revoke.
  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    const session = await this.sessions.resolve('refresh', refreshToken);
    if (!session.ok) {
      const level = session.failure === 'missing' ? 'debug' : 'warn';
      this.logger[level](
        { reason: session.failure, userId: session.userId },
        'refresh failed',
      );
      throw new AppException(
        ErrorCode.AUTH_REFRESH_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }
    const tokens = await this.sessionTokens.issue(session.user);
    this.logger.log({ userId: session.user.id }, 'session refreshed');
    return tokens;
  }

  // Notion "Регистрация" 1.3.1: confirmation off → active account; on → pending account plus an
  // e-mailed code and link (decision A5).
  async register(input: RegisterInput): Promise<RegisterResult> {
    const passwordHash = await this.passwordHasher.hash(input.password);
    let result: RegisterResult;
    try {
      result = await this.createAccount(input.email, passwordHash);
    } catch (error: unknown) {
      this.logger.warn({ reason: failureReason(error) }, 'registration failed');
      throw error;
    }
    const confirmationRequired = result.kind === 'confirmation_required';
    this.logger.log(
      { confirmationRequired, userId: result.user.id },
      'registration succeeded',
    );
    if (result.kind === 'confirmation_required') {
      this.logConfirmationSent(result.challenge.challengeId, result.user.id);
    }
    return result;
  }

  // Notion "Аутентификация" 1.2: confirmation off → tokens; on → no tokens, a pending sign-in
  // (challenge with purpose `login`) and an e-mailed code and link.
  async login(input: LoginInput, clientIp: string): Promise<LoginResult> {
    const attempt = this.lockout.begin(
      LoginLockout.keyOf(clientIp, input.email),
    );
    let credentials: Awaited<
      ReturnType<UsersService['findCredentialsByEmail']>
    >;
    try {
      credentials = await this.users.findCredentialsByEmail(input.email);
      const valid = await this.passwordHasher.verify(
        credentials?.passwordHash,
        input.password,
      );
      if (!credentials || !valid) {
        attempt.fail();
        this.logger.warn(
          {
            reason: ErrorCode.AUTH_INVALID_CREDENTIALS,
            userId: credentials?.user.id,
          },
          'login failed',
        );
        throw new AppException(
          ErrorCode.AUTH_INVALID_CREDENTIALS,
          HttpStatus.UNAUTHORIZED,
        );
      }
      // The password is proven from here on: not a guessing attempt.
      attempt.succeed();
    } finally {
      attempt.release();
    }
    const { user } = credentials;
    if (user.status !== 'active') {
      this.logger.warn(
        { reason: ErrorCode.AUTH_ACCOUNT_NOT_VERIFIED, userId: user.id },
        'login failed',
      );
      throw new AppException(
        ErrorCode.AUTH_ACCOUNT_NOT_VERIFIED,
        HttpStatus.FORBIDDEN,
      );
    }
    if (await this.settings.isEnabled('confirmation.login')) {
      const challenge = await this.startConfirmedLogin(user);
      this.logger.log({ userId: user.id }, 'login pending confirmation');
      this.logConfirmationSent(challenge.challengeId, user.id);
      return { challenge, kind: 'confirmation_required', user };
    }
    const session = await this.signIn(user);
    this.logger.log({ userId: user.id }, 'login succeeded');
    return { kind: 'signed_in', session, user };
  }

  async confirmWithCode(
    challengeId: string,
    code: string,
  ): Promise<ConfirmResult> {
    return this.confirm({ challengeId, method: 'code' }, () =>
      this.challenges.verifyCode(challengeId, code),
    );
  }

  // `boundChallengeId` is the `login_challenge` cookie of the browser that opened the link.
  async confirmWithToken(
    token: string,
    boundChallengeId: string | undefined,
  ): Promise<ConfirmResult> {
    return this.confirm({ method: 'link' }, async () => {
      const challenge = await this.challenges.verifyToken(token);
      // Login CSRF guard (decision A17): a sign-in link never signs a different browser in.
      if (challenge.purpose === 'login' && challenge.id !== boundChallengeId) {
        throw new AppException(
          ErrorCode.AUTH_CHALLENGE_OTHER_BROWSER,
          HttpStatus.FORBIDDEN,
        );
      }
      return challenge;
    });
  }

  async resendConfirmation(
    challengeId: string,
  ): Promise<IssuedChallenge & { purpose: ChallengePurpose }> {
    const issued = await this.rotate(challengeId);
    this.logConfirmationSent(issued.challengeId, issued.userId);
    return {
      challengeId: issued.challengeId,
      expiresAt: issued.expiresAt,
      purpose: issued.purpose,
    };
  }

  private async confirm(
    fields: Readonly<Record<string, string>>,
    verify: () => Promise<Challenge>,
  ): Promise<ConfirmResult> {
    try {
      const challenge = await verify();
      const user = await this.complete(challenge);
      const result: ConfirmResult =
        challenge.purpose === 'login'
          ? { session: await this.sessionTokens.issue(user), user }
          : { user };
      this.logger.log(
        {
          ...fields,
          challengeId: challenge.id,
          purpose: challenge.purpose,
          userId: user.id,
        },
        'confirmation succeeded',
      );
      if (challenge.purpose === 'login') {
        this.logger.log({ userId: user.id }, 'login succeeded');
      }
      return result;
    } catch (error: unknown) {
      this.logger.warn(
        { ...fields, reason: failureReason(error) },
        'confirmation failed',
      );
      throw error;
    }
  }

  @Transactional()
  private async complete(challenge: Challenge): Promise<User> {
    await this.challenges.consume(challenge);
    if (challenge.purpose === 'registration') {
      return this.users.activate(challenge.user.id);
    }
    const user = await this.users.getActive(challenge.user.id);
    // Password reset, deletion or a block since the sign-in started void it (decision A2).
    if (challenge.tokenVersion !== user.tokenVersion) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.users.recordLogin(user.id);
    return user;
  }

  @Transactional()
  private async createAccount(
    email: string,
    passwordHash: string,
  ): Promise<RegisterResult> {
    const ttlMs = this.config.confirmation.ttlSeconds * 1000;
    await this.users.releaseStalePending(email, new Date(Date.now() - ttlMs));
    const confirm = await this.settings.isEnabled('confirmation.registration');
    const user = await this.users.create({
      email,
      passwordHash,
      status: confirm ? 'pending_verification' : 'active',
    });
    if (!confirm) return { kind: 'registered', user };
    const challenge = await this.challenges.issue('registration', user);
    return { challenge, kind: 'confirmation_required', user };
  }

  private logConfirmationSent(challengeId: string, userId: string): void {
    this.logger.log({ challengeId, userId }, 'confirmation sent');
  }

  @Transactional()
  private async rotate(
    challengeId: string,
  ): Promise<IssuedChallenge & { purpose: ChallengePurpose; userId: string }> {
    return this.challenges.resend(challengeId);
  }

  private async signIn(user: User): Promise<SessionTokens> {
    await this.users.recordLogin(user.id);
    return this.sessionTokens.issue(user);
  }

  @Transactional()
  private async startConfirmedLogin(user: User): Promise<IssuedChallenge> {
    return this.challenges.issue('login', user);
  }
}
