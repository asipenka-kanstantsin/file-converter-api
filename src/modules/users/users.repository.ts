import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { PrismaService } from '@/infrastructure/database';

import type {
  NewUser,
  SessionUser,
  User,
  UserChanges,
  UserCredentials,
} from './users.types';

const userSelect = {
  createdAt: true,
  displayName: true,
  email: true,
  id: true,
  lastLoginAt: true,
  photoFileId: true,
  status: true,
  tokenVersion: true,
} as const;

@Injectable()
export class UsersRepository {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  // Only from pending_verification, so a replayed confirmation cannot resurrect another state.
  async activate(id: string): Promise<User | null> {
    const { count } = await this.txHost.tx.user.updateMany({
      data: { status: 'active' },
      where: { id, status: 'pending_verification' },
    });
    return count === 0 ? null : this.findById(id);
  }

  // Removes an unconfirmed account created before the cutoff; its challenges cascade.
  async deleteStalePending(
    email: string,
    createdBefore: Date,
  ): Promise<boolean> {
    const { count } = await this.txHost.tx.user.deleteMany({
      where: {
        // A resend extends the challenge: an account with a live challenge is still in progress.
        challenges: {
          none: { consumedAt: null, expiresAt: { gt: new Date() } },
        },
        createdAt: { lt: createdBefore },
        email,
        status: 'pending_verification',
      },
    });
    return count === 1;
  }

  // Blocking ends every session at once (token_version + 1, decision A2).
  async update(id: string, changes: UserChanges): Promise<User> {
    return this.txHost.tx.user.update({
      data: {
        ...changes,
        ...(changes.status === 'blocked'
          ? { tokenVersion: { increment: 1 } }
          : {}),
      },
      select: userSelect,
      where: { id },
    });
  }

  // Decision D1: the row stays as a tombstone (the admin list filters by `deleted`); every
  // personal value goes. The address is freed for a new registration; sessions end (A2).
  async anonymise(id: string): Promise<User> {
    return this.txHost.tx.user.update({
      data: {
        deletedAt: new Date(),
        displayName: null,
        email: `deleted-${id}@deleted.invalid`,
        lastLoginAt: null,
        // Not a hash: nothing verifies against it.
        passwordHash: '!',
        photoFileId: null,
        status: 'deleted',
        tokenVersion: { increment: 1 },
      },
      select: userSelect,
      where: { id },
    });
  }

  async setPhoto(id: string, fileId: null | string): Promise<void> {
    await this.txHost.tx.user.update({
      data: { photoFileId: fileId },
      where: { id },
    });
  }

  async create(input: NewUser): Promise<User> {
    return this.txHost.tx.user.create({ data: input, select: userSelect });
  }

  async existsByEmail(email: string): Promise<boolean> {
    const row = await this.txHost.tx.user.findUnique({
      select: { id: true },
      where: { email },
    });
    return row !== null;
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const row = await this.txHost.tx.user.findUnique({
      select: { ...userSelect, passwordHash: true },
      where: { email },
    });
    // A tombstone (D1) is no account: the caller verifies against the dummy hash (A16).
    if (!row || row.status === 'deleted') return null;
    const { passwordHash, ...user } = row;
    return { passwordHash, user };
  }

  async recordLogin(id: string): Promise<void> {
    await this.txHost.tx.user.update({
      data: { lastLoginAt: new Date() },
      select: { id: true },
      where: { id },
    });
  }

  // One indexed query per authenticated request: the user and their role ids.
  async findSessionUser(id: string): Promise<SessionUser | null> {
    const row = await this.txHost.tx.user.findUnique({
      select: { ...userSelect, roles: { select: { roleId: true } } },
      where: { id },
    });
    if (!row) return null;
    const { roles, ...user } = row;
    return { ...user, roleIds: roles.map((role) => role.roleId) };
  }

  // FOR UPDATE: for a transaction that then updates the row. A FOR SHARE lock upgraded by an
  // UPDATE deadlocks against a concurrent one doing the same.
  async lockForUpdate(id: string): Promise<User | null> {
    const rows = z
      .array(z.object({ id: z.string() }))
      .parse(
        await this.txHost.tx
          .$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`,
      );
    return rows.length === 0 ? null : this.findAnyById(id);
  }

  // FOR SHARE: the account cannot be deleted or change status until the transaction ends.
  async lockForShare(id: string): Promise<User | null> {
    const rows = z
      .array(z.object({ id: z.string() }))
      .parse(
        await this.txHost.tx
          .$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR SHARE`,
      );
    return rows.length === 0 ? null : this.findById(id);
  }

  // A deleted account is a tombstone (D1): to everything but deletion itself it does not exist.
  async findById(id: string): Promise<User | null> {
    const user = await this.findAnyById(id);
    return user?.status === 'deleted' ? null : user;
  }

  async findAnyById(id: string): Promise<User | null> {
    return this.txHost.tx.user.findUnique({
      select: userSelect,
      where: { id },
    });
  }
}
