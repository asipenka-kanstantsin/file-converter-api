import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { PrismaService } from '@/infrastructure/database';

import type {
  Challenge,
  ChallengePurpose,
  ChallengeSecrets,
} from './challenges.types';

const challengeSelect = {
  attempts: true,
  codeHash: true,
  consumedAt: true,
  expiresAt: true,
  id: true,
  lastSentAt: true,
  purpose: true,
  tokenVersion: true,
  user: { select: { email: true, id: true } },
} as const;

const reservationRowSchema = z.array(
  z.object({ attempts: z.number().int(), code_hash: z.string() }),
);

@Injectable()
export class ChallengesRepository {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  // Conditional update: only one of two concurrent confirmations wins, and never after expiry.
  async consume(id: string): Promise<boolean> {
    const { count } = await this.txHost.tx.challenge.updateMany({
      data: { consumedAt: new Date() },
      where: { consumedAt: null, expiresAt: { gt: new Date() }, id },
    });
    return count === 1;
  }

  async create(
    purpose: ChallengePurpose,
    user: { id: string; tokenVersion?: number },
    secrets: ChallengeSecrets,
  ): Promise<{ expiresAt: Date; id: string }> {
    return this.txHost.tx.challenge.create({
      data: {
        codeHash: secrets.codeHash,
        expiresAt: secrets.expiresAt,
        lastSentAt: secrets.sentAt,
        purpose,
        tokenHash: secrets.tokenHash,
        tokenVersion: user.tokenVersion ?? null,
        userId: user.id,
      },
      select: { expiresAt: true, id: true },
    });
  }

  // A new sign-in voids the user's earlier pending sign-ins: one live code and link at a time.
  async voidPending(userId: string, purpose: ChallengePurpose): Promise<void> {
    await this.txHost.tx.challenge.updateMany({
      data: { consumedAt: new Date() },
      where: { consumedAt: null, purpose, userId },
    });
  }

  async findById(id: string): Promise<Challenge | null> {
    return this.txHost.tx.challenge.findUnique({
      select: challengeSelect,
      where: { id },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Challenge | null> {
    return this.txHost.tx.challenge.findUnique({
      select: challengeSelect,
      where: { tokenHash },
    });
  }

  // Takes one attempt before the code is compared, in a single statement: parallel guesses
  // cannot all see "attempts < max" (Notion: 5 attempts). Null = nothing left to take.
  async reserveAttempt(
    id: string,
    maxAttempts: number,
  ): Promise<{ attempts: number; codeHash: string } | null> {
    const rows: unknown = await this.txHost.tx.$queryRaw`
      UPDATE challenges
         SET attempts = attempts + 1
       WHERE id = ${id}::uuid
         AND consumed_at IS NULL
         AND expires_at > now()
         AND attempts < ${maxAttempts}
      RETURNING attempts, code_hash`;
    // The code hash comes from the same statement, so a concurrent resend cannot make an
    // already rotated code compare against the stale hash.
    const row = reservationRowSchema.parse(rows)[0];
    return row ? { attempts: row.attempts, codeHash: row.code_hash } : null;
  }

  // Rotates only when the resend cooldown has passed, so concurrent resends send one mail.
  async rotateIfDue(
    id: string,
    sentBefore: Date,
    secrets: ChallengeSecrets,
  ): Promise<boolean> {
    const { count } = await this.txHost.tx.challenge.updateMany({
      data: {
        attempts: 0,
        codeHash: secrets.codeHash,
        expiresAt: secrets.expiresAt,
        lastSentAt: secrets.sentAt,
        tokenHash: secrets.tokenHash,
      },
      where: { consumedAt: null, id, lastSentAt: { lte: sentBefore } },
    });
    return count === 1;
  }
}
