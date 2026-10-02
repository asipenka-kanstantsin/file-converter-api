import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '@/common/errors';
import { AppConfig } from '@/config';
import { mapPrismaException } from '@/infrastructure/database';
import { SettingsService } from '@/modules/settings';
import { type User, UsersService } from '@/modules/users';

import { ChallengesService } from './challenges.service';
import type { Challenge, IssuedChallenge } from './challenges.types';
import type { RegisterInput } from './dto/register.dto';
import { PasswordHasher } from './password-hasher';

export type RegisterResult =
  | { challenge: IssuedChallenge; kind: 'confirmation_required'; user: User }
  | { kind: 'registered'; user: User };

function failureReason(error: unknown): string {
  if (error instanceof AppException) return error.code;
  return mapPrismaException(error)?.code ?? 'unexpected';
}

// Audit events of Notion "Регистрация" 1.5 are logged here, after the transaction committed;
// requests rejected before the service (validation, CSRF, rate limit) are logged by the filter.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly challenges: ChallengesService,
    private readonly config: AppConfig,
    private readonly passwordHasher: PasswordHasher,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
  ) {}

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

  async confirmWithCode(challengeId: string, code: string): Promise<User> {
    return this.confirm({ challengeId, method: 'code' }, () =>
      this.challenges.verifyCode(challengeId, code),
    );
  }

  async confirmWithToken(token: string): Promise<User> {
    return this.confirm({ method: 'link' }, () =>
      this.challenges.verifyToken(token),
    );
  }

  async resendConfirmation(challengeId: string): Promise<IssuedChallenge> {
    const issued = await this.rotate(challengeId);
    this.logConfirmationSent(issued.challengeId, issued.userId);
    return { challengeId: issued.challengeId, expiresAt: issued.expiresAt };
  }

  private async confirm(
    fields: Readonly<Record<string, string>>,
    verify: () => Promise<Challenge>,
  ): Promise<User> {
    try {
      const challenge = await verify();
      const user = await this.complete(challenge);
      this.logger.log(
        {
          ...fields,
          challengeId: challenge.id,
          purpose: challenge.purpose,
          userId: user.id,
        },
        'confirmation succeeded',
      );
      return user;
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
    return this.users.activate(challenge.user.id);
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
  ): Promise<IssuedChallenge & { userId: string }> {
    return this.challenges.resend(challengeId);
  }
}
