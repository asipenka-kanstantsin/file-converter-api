import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';
import { MailService } from '@/infrastructure/mail';

import {
  hashCode,
  hashToken,
  newConfirmationCode,
  newMagicLinkToken,
  sameHash,
} from './challenge-secrets';
import { ChallengesRepository } from './challenges.repository';
import type {
  Challenge,
  ChallengePurpose,
  ChallengeSecrets,
  IssuedChallenge,
} from './challenges.types';

// Started by a signed-in or signing-in user: bound to token_version (A2) and voided by a newer
// request of the same purpose, so only one code and link is live at a time.
const SESSION_BOUND: ReadonlySet<ChallengePurpose> = new Set([
  'account_deletion',
  'email_change',
  'login',
]);

// email_change mails the new address; everything else the account's address.
function recipientOf(challenge: {
  newEmail: null | string;
  user: { email: string };
}): string {
  return challenge.newEmail ?? challenge.user.email;
}

// E-mail confirmation by 6-digit code or magic link (decision A4, Notion "Регистрация" 1.3.2):
// TTL, attempt limit and resend cooldown come from config. Every state change is a conditional
// statement, so concurrent requests cannot bypass a limit.
@Injectable()
export class ChallengesService {
  constructor(
    private readonly challengesRepository: ChallengesRepository,
    private readonly config: AppConfig,
    private readonly mail: MailService,
  ) {}

  // Inside the caller's transaction: the row and its mail commit together.
  async issue(
    purpose: ChallengePurpose,
    user: { email: string; id: string; tokenVersion?: number },
    newEmail?: string,
  ): Promise<IssuedChallenge> {
    const { code, secrets, token } = this.newSecrets();
    const bound = SESSION_BOUND.has(purpose);
    if (bound) await this.challengesRepository.voidPending(user.id, purpose);
    const row = await this.challengesRepository.create(
      purpose,
      { id: user.id, tokenVersion: bound ? user.tokenVersion : undefined },
      secrets,
      newEmail,
    );
    await this.sendMail(
      row.id,
      purpose,
      recipientOf({ newEmail: newEmail ?? null, user }),
      code,
      token,
      secrets.sentAt,
    );
    return { challengeId: row.id, expiresAt: row.expiresAt };
  }

  // Inside the caller's transaction: the rotation and its mail commit together.
  async resend(
    challengeId: string,
  ): Promise<IssuedChallenge & { purpose: ChallengePurpose; userId: string }> {
    const challenge = await this.findPending(challengeId);
    const { maxResends, resendCooldownSeconds } = this.config.confirmation;
    const cooldownMs = resendCooldownSeconds * 1000;
    const { code, secrets, token } = this.newSecrets();
    const sentBefore = new Date(secrets.sentAt.getTime() - cooldownMs);
    if (
      !(await this.challengesRepository.rotateIfDue(
        challenge.id,
        sentBefore,
        secrets,
        maxResends,
      ))
    ) {
      const current = await this.findPending(challengeId);
      // Out of resends is permanent for this challenge: a retryAfter would send the client back
      // into the same wall. Waiting for the cooldown is the only one worth retrying.
      if (current.rotations >= maxResends) {
        throw new AppException(
          ErrorCode.AUTH_CHALLENGE_RESEND_LIMIT,
          HttpStatus.LOCKED,
        );
      }
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (current.lastSentAt.getTime() + cooldownMs - Date.now()) / 1000,
        ),
      );
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        {
          retryAfter,
        },
      );
    }
    await this.sendMail(
      challenge.id,
      challenge.purpose,
      recipientOf(challenge),
      code,
      token,
      secrets.sentAt,
    );
    return {
      challengeId,
      expiresAt: secrets.expiresAt,
      purpose: challenge.purpose,
      userId: challenge.user.id,
    };
  }

  // The pending challenge without touching its attempts: lets a caller refuse a challenge of the
  // wrong purpose or owner before a code is compared (no oracle, no attempt spent).
  async peek(challengeId: string): Promise<Challenge> {
    return this.findPending(challengeId);
  }

  deleteForUser(userId: string): Promise<string[]> {
    return this.challengesRepository.deleteForUser(userId);
  }

  async voidPending(userId: string, purpose: ChallengePurpose): Promise<void> {
    await this.challengesRepository.voidPending(userId, purpose);
  }

  // Checks a code without consuming the challenge. The attempt is taken before the comparison
  // and outside the caller's transaction, so it counts even though the request then fails.
  async verifyCode(challengeId: string, code: string): Promise<Challenge> {
    const challenge = await this.findPending(challengeId);
    this.assertUsable(challenge);
    const { maxAttempts } = this.config.confirmation;
    const reserved = await this.challengesRepository.reserveAttempt(
      challenge.id,
      maxAttempts,
    );
    if (reserved === null) {
      // Lost a race: consumed, expired or locked between the read and the reservation.
      this.assertUsable(await this.findPending(challengeId));
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      sameHash(reserved.codeHash, hashCode(code, this.config.auth.otpPepper))
    ) {
      return challenge;
    }
    const attemptsLeft = maxAttempts - reserved.attempts;
    if (attemptsLeft <= 0) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_LOCKED,
        HttpStatus.LOCKED,
      );
    }
    throw new AppException(
      ErrorCode.AUTH_CODE_INVALID,
      HttpStatus.BAD_REQUEST,
      {
        attemptsLeft,
      },
    );
  }

  async verifyToken(token: string): Promise<Challenge> {
    const challenge = await this.challengesRepository.findByTokenHash(
      hashToken(token),
    );
    if (!challenge || challenge.consumedAt) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    this.assertUsable(challenge);
    return challenge;
  }

  // Inside the transaction that completes the confirmed action.
  async consume(challenge: Challenge): Promise<void> {
    if (!(await this.challengesRepository.consume(challenge.id))) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertUsable(challenge: Challenge): void {
    if (challenge.attempts >= this.config.confirmation.maxAttempts) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_LOCKED,
        HttpStatus.LOCKED,
      );
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_EXPIRED,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async findPending(challengeId: string): Promise<Challenge> {
    const challenge = await this.challengesRepository.findById(challengeId);
    if (!challenge || challenge.consumedAt) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    return challenge;
  }

  private newSecrets(): {
    code: string;
    secrets: ChallengeSecrets;
    token: string;
  } {
    const code = newConfirmationCode();
    const token = newMagicLinkToken();
    const sentAt = new Date();
    return {
      code,
      secrets: {
        codeHash: hashCode(code, this.config.auth.otpPepper),
        expiresAt: new Date(
          sentAt.getTime() + this.config.confirmation.ttlSeconds * 1000,
        ),
        sentAt,
        tokenHash: hashToken(token),
      },
      token,
    };
  }

  private async sendMail(
    challengeId: string,
    purpose: ChallengePurpose,
    email: string,
    code: string,
    token: string,
    sentAt: Date,
  ): Promise<void> {
    await this.mail.enqueue(
      'auth.confirmation',
      email,
      {
        code,
        expiresInMinutes: Math.ceil(this.config.confirmation.ttlSeconds / 60),
        link: `${this.config.app.publicUrl}/api/auth/confirm?token=${token}`,
        purpose,
      },
      `auth.confirmation:${challengeId}:${String(sentAt.getTime())}`,
    );
  }
}
