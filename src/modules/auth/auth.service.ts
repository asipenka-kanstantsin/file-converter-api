import { Transactional } from '@nestjs-cls/transactional';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';
import { mapPrismaException } from '@/infrastructure/database';
import { MailService } from '@/infrastructure/mail';
import { SettingsService } from '@/modules/settings';
import { type User, UsersService } from '@/modules/users';

import { ChallengesService } from './challenges.service';
import type {
  Challenge,
  ChallengePurpose,
  IssuedChallenge,
} from './challenges.types';
import { ConfirmationHandlers } from './confirmation-handlers';
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

export type OwnerConfirmation =
  { challengeId: string; code: string } | { token: string };

// A confirmed sign-in carries a session; a confirmed registration does not (decision A9).
export interface ConfirmResult {
  session?: SessionTokens;
  user: User;
}

// Confirmable without a session through POST/GET /api/auth/confirm; everything else is an
// account change that needs its owner (E1).
const PUBLIC_PURPOSES: ReadonlySet<ChallengePurpose> = new Set([
  'login',
  'registration',
]);

function invalidChallenge(): never {
  throw new AppException(
    ErrorCode.AUTH_CHALLENGE_INVALID,
    HttpStatus.BAD_REQUEST,
  );
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
    private readonly handlers: ConfirmationHandlers,
    private readonly lockout: LoginLockout,
    private readonly mail: MailService,
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
      // The password is proven, so naming the reason leaks nothing (decision A16).
      const reason =
        user.status === 'blocked'
          ? ErrorCode.AUTH_ACCOUNT_BLOCKED
          : ErrorCode.AUTH_ACCOUNT_NOT_VERIFIED;
      this.logger.warn({ reason, userId: user.id }, 'login failed');
      throw new AppException(reason, HttpStatus.FORBIDDEN);
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

  // POST /api/auth/confirm completes registrations and sign-ins only; an account change is
  // confirmed by its owner (decision E1). The purpose is checked before the code is compared,
  // so no attempt is spent and nothing is revealed.
  async confirmWithCode(
    challengeId: string,
    code: string,
  ): Promise<ConfirmResult> {
    return this.confirm({ challengeId, method: 'code' }, async () => {
      const pending = await this.challenges.peek(challengeId);
      if (!PUBLIC_PURPOSES.has(pending.purpose)) invalidChallenge();
      return this.challenges.verifyCode(challengeId, code);
    });
  }

  // Notion "Изменение данных пользователя" 1.3.2: Self asks to change the e-mail; a code and a
  // link go to the new address. Nothing changes until it is confirmed.
  async startEmailChange(
    userId: string,
    newEmail: string,
  ): Promise<IssuedChallenge> {
    const issued = await this.issueEmailChange(userId, newEmail);
    this.logger.log(
      { challengeId: issued.challengeId, userId },
      'email change requested',
    );
    this.logConfirmationSent(issued.challengeId, userId);
    return issued;
  }

  // 1.3.3: by its owner, with the code or the link token. Purpose and owner are checked first,
  // so a foreign challenge spends no attempt and reveals nothing (same 400 as unknown).
  async confirmEmailChange(
    userId: string,
    input: OwnerConfirmation,
  ): Promise<User> {
    return this.confirmByOwner('email_change', userId, input);
  }

  // Notion "Удаление пользователя" 1.3.1: Self-delete only after an e-mailed confirmation.
  async startAccountDeletion(userId: string): Promise<IssuedChallenge> {
    const issued = await this.issueAccountDeletion(userId);
    this.logConfirmationSent(issued.challengeId, userId);
    return issued;
  }

  async confirmAccountDeletion(
    userId: string,
    input: OwnerConfirmation,
  ): Promise<User> {
    return this.confirmByOwner('account_deletion', userId, input);
  }

  // Everything an admin deletion must also take with it (D1); in the caller's transaction.
  async forgetUser(userId: string): Promise<void> {
    const challengeIds = await this.challenges.deleteForUser(userId);
    // Unsent mails still hold addresses: their keys name the challenge or the user.
    await this.mail.discardUnsent([
      ...challengeIds.map((id) => `auth.confirmation:${id}:`),
      `account.email_changed:${userId}:`,
    ]);
  }

  private async confirmByOwner(
    purpose: ChallengePurpose,
    userId: string,
    input: OwnerConfirmation,
  ): Promise<User> {
    const fields: Record<string, string> =
      'token' in input
        ? { method: 'link', purpose }
        : { challengeId: input.challengeId, method: 'code', purpose };
    const result = await this.confirm(fields, async () => {
      const challenge =
        'token' in input
          ? await this.challenges.verifyToken(input.token)
          : await this.challenges.peek(input.challengeId);
      if (challenge.purpose !== purpose || challenge.user.id !== userId) {
        invalidChallenge();
      }
      return 'token' in input
        ? challenge
        : this.challenges.verifyCode(input.challengeId, input.code);
    });
    return result.user;
  }

  // An admin set the e-mail directly (P5): a pending self request must not overwrite it later,
  // and the previous address is told. In the admin's transaction.
  async afterAdminEmailChange(
    userId: string,
    previousEmail: string,
  ): Promise<void> {
    await this.challenges.voidPending(userId, 'email_change');
    await this.notifyEmailChanged(userId, previousEmail);
  }

  // `boundChallengeId` is the `login_challenge` cookie of the browser that opened the link;
  // `sessionUserId` the account signed in there, if any.
  async confirmWithToken(
    token: string,
    boundChallengeId: string | undefined,
    sessionUserId?: string,
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
      // An account change by link only where its owner is signed in (E1): a prefetching scanner
      // or whoever owns a mistyped address cannot complete it.
      if (
        !PUBLIC_PURPOSES.has(challenge.purpose) &&
        challenge.user.id !== sessionUserId
      ) {
        throw new AppException(
          ErrorCode.AUTH_CHALLENGE_SESSION_REQUIRED,
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
      this.handlers.get(challenge.purpose)?.completed?.(user.id);
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
    const handler = this.handlers.get(challenge.purpose);
    // Account changes lock the user row (and what else their handler needs) before the
    // challenge row — the order an admin's PATCH or DELETE uses — so a block or a deletion
    // committing meanwhile cannot slip past the version check.
    const locked = handler
      ? await handler.lock(challenge.user.id)
      : challenge.purpose === 'email_change'
        ? await this.users.lockForUpdate(challenge.user.id)
        : undefined;
    await this.challenges.consume(challenge);
    if (challenge.purpose === 'registration') {
      return this.users.activate(challenge.user.id);
    }
    const user = locked ?? (await this.users.getActive(challenge.user.id));
    if (user.status !== 'active') invalidChallenge();
    // Password reset, deletion or a block since it started void it (decision A2).
    if (challenge.tokenVersion !== user.tokenVersion) invalidChallenge();
    if (handler) return handler.complete(user.id);
    // An account change whose module did not register: never fall through to a sign-in.
    if (challenge.purpose !== 'email_change' && challenge.purpose !== 'login') {
      throw new Error(`no confirmation handler for ${challenge.purpose}`);
    }
    if (challenge.purpose === 'email_change') {
      if (!challenge.newEmail) invalidChallenge();
      // Taken meanwhile → 409 USER_EMAIL_TAKEN, and the challenge stays unconsumed (rollback).
      const changed = await this.users.update(user.id, {
        email: challenge.newEmail,
      });
      await this.notifyEmailChanged(user.id, user.email);
      this.logger.log({ userId: user.id }, 'email changed');
      return changed;
    }
    await this.users.recordLogin(user.id);
    return user;
  }

  @Transactional()
  private async issueEmailChange(
    userId: string,
    newEmail: string,
  ): Promise<IssuedChallenge> {
    const user = await this.users.getActive(userId);
    if (
      user.email === newEmail ||
      !(await this.users.isEmailAvailable(newEmail))
    ) {
      throw new AppException(ErrorCode.USER_EMAIL_TAKEN, HttpStatus.CONFLICT);
    }
    return this.challenges.issue('email_change', user, newEmail);
  }

  @Transactional()
  private async issueAccountDeletion(userId: string): Promise<IssuedChallenge> {
    const user = await this.users.getActive(userId);
    return this.challenges.issue('account_deletion', user);
  }

  // A notice to the address that was replaced: no secrets, only that it happened.
  private async notifyEmailChanged(
    userId: string,
    previousEmail: string,
  ): Promise<void> {
    await this.mail.enqueue(
      'account.email_changed',
      previousEmail,
      {},
      `account.email_changed:${userId}:${String(Date.now())}`,
    );
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
