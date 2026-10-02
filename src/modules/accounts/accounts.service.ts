import { Transactional } from '@nestjs-cls/transactional';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
import { mapPrismaException } from '@/infrastructure/database';
import type { StoredObject } from '@/infrastructure/storage';
import { AuthService } from '@/modules/auth';
import { FilesService } from '@/modules/files';
import { RbacAdminService, RbacService } from '@/modules/rbac';
import { type User, type UserChanges, UsersService } from '@/modules/users';

import { processPhoto } from './photo.processor';
import { type Profile, toProfile } from './profile.policy';

export type ProfilePatch = UserChanges;

// Decision P5: what each caller may change. Self without users@update: its own display name
// (e-mail only through confirmation, 1.3.2); users@update: any field, e-mail directly (1.3.4).
const SELF_FIELDS: ReadonlySet<keyof ProfilePatch> = new Set(['displayName']);
const ADMIN_FIELDS: ReadonlySet<keyof ProfilePatch> = new Set([
  'displayName',
  'email',
  'status',
]);

interface IssuedChallenge {
  challengeId: string;
  expiresAt: Date;
}

function forbidden(context?: Record<string, unknown>): never {
  throw new AppException(
    ErrorCode.AUTH_FORBIDDEN,
    HttpStatus.FORBIDDEN,
    context,
  );
}

function notFound(): never {
  throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function resultOf(error: unknown): number {
  if (error instanceof AppException) return error.status;
  return mapPrismaException(error)?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
}

// Self-or-permission access to one account (Notion "Просмотр…", "Изменение данных
// пользователя"). Ownership is decided here, before any lookup when the id is in the path (P2).
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly files: FilesService,
    private readonly rbac: RbacService,
    private readonly rbacAdmin: RbacAdminService,
    private readonly users: UsersService,
  ) {}

  async getProfile(actor: AuthUser, userId: string): Promise<Profile> {
    const isSelf = actor.id === userId;
    const audit = { targetUserId: userId, viewerUserId: actor.id };
    if (!isSelf && !this.rbac.can(actor.roleIds, 'users', 'read')) {
      this.logger.warn(
        { ...audit, result: HttpStatus.FORBIDDEN },
        'profile view refused',
      );
      forbidden();
    }
    const user = await this.users.findById(userId);
    if (!user) {
      this.logger.log(
        { ...audit, result: HttpStatus.NOT_FOUND },
        'profile viewed',
      );
      notFound();
    }
    this.logger.log({ ...audit, result: HttpStatus.OK }, 'profile viewed');
    return toProfile(user, isSelf ? 'self' : 'other');
  }

  // Notion 1.3.1. A field the caller may not change → 403 naming the fields (1.4); the audit log
  // records field names only, never values (1.5).
  async updateProfile(
    actor: AuthUser,
    userId: string,
    patch: ProfilePatch,
  ): Promise<Profile> {
    const fields = Object.keys(patch) as (keyof ProfilePatch)[];
    const audit = { actorUserId: actor.id, fields, targetUserId: userId };
    try {
      const isSelf = actor.id === userId;
      const canUpdate = this.rbac.can(actor.roleIds, 'users', 'update');
      if (!isSelf && !canUpdate) forbidden();
      const allowed = canUpdate ? ADMIN_FIELDS : SELF_FIELDS;
      const refused = fields.filter((field) => !allowed.has(field));
      if (refused.length > 0) forbidden({ fields: refused });
      const user = await this.applyChanges(actor, userId, patch);
      this.logger.log({ ...audit, result: HttpStatus.OK }, 'profile changed');
      return toProfile(user, isSelf ? 'self' : 'other');
    } catch (error: unknown) {
      this.logger.warn(
        { ...audit, result: resultOf(error) },
        'profile change refused',
      );
      throw error;
    }
  }

  // Notion 1.3.2: Self only — an admin changes the e-mail directly through PATCH (1.3.4, H6).
  async startEmailChange(
    actor: AuthUser,
    userId: string,
    newEmail: string,
  ): Promise<IssuedChallenge> {
    if (actor.id !== userId) forbidden();
    return this.auth.startEmailChange(userId, newEmail);
  }

  async confirmEmailChange(
    actor: AuthUser,
    userId: string,
    input: { challengeId: string; code: string } | { token: string },
  ): Promise<Profile> {
    if (actor.id !== userId) forbidden();
    return toProfile(await this.auth.confirmEmailChange(userId, input), 'self');
  }

  // Photo: Self or users@update to change it, Self or users@read to see it (P4).

  async replacePhoto(
    actor: AuthUser,
    userId: string,
    upload: Buffer,
  ): Promise<Profile> {
    const audit = { actorUserId: actor.id, targetUserId: userId };
    try {
      const isSelf = this.requireAccess(actor, userId, 'update');
      if (!(await this.users.findById(userId))) notFound();
      const photo = await processPhoto(upload);
      // Object first, then row + link + the old photo's removal in one transaction (12-storage).
      const updated = await this.files.storeWithin(
        {
          body: photo.body,
          mime: photo.mime,
          ownerId: userId,
          purpose: 'avatar',
        },
        (file) => this.linkPhoto(userId, file.id),
      );
      this.logger.log(audit, 'photo changed');
      return toProfile(updated, isSelf ? 'self' : 'other');
    } catch (error: unknown) {
      this.logger.warn(
        { ...audit, result: resultOf(error) },
        'photo change refused',
      );
      throw error;
    }
  }

  async removePhoto(actor: AuthUser, userId: string): Promise<void> {
    this.requireAccess(actor, userId, 'update');
    await this.unlinkPhoto(userId);
    this.logger.log(
      { actorUserId: actor.id, targetUserId: userId },
      'photo removed',
    );
  }

  async openPhoto(actor: AuthUser, userId: string): Promise<StoredObject> {
    this.requireAccess(actor, userId, 'read');
    const user = (await this.users.findById(userId)) ?? notFound();
    const photo = user.photoFileId
      ? await this.files.open(user.photoFileId)
      : null;
    if (!photo) {
      throw new AppException(ErrorCode.PHOTO_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return photo;
  }

  // Self, or the permission for someone else; refused before any lookup (P2). True when Self.
  private requireAccess(
    actor: AuthUser,
    userId: string,
    action: 'read' | 'update',
  ): boolean {
    const isSelf = actor.id === userId;
    if (!isSelf && !this.rbac.can(actor.roleIds, 'users', action)) forbidden();
    return isSelf;
  }

  // Changing the e-mail or status of an account that administers RBAC hands over that
  // account (the e-mail is how it is recovered): only someone holding rbac@manage may (P7).
  private async assertMayTakeOver(
    actor: AuthUser,
    userId: string,
  ): Promise<void> {
    const target = await this.users.findSessionUser(userId);
    if (
      target &&
      this.rbac.can(target.roleIds, 'rbac', 'manage') &&
      !this.rbac.can(actor.roleIds, 'rbac', 'manage')
    ) {
      forbidden();
    }
  }

  // One transaction (Notion 1.6). Lock order as everywhere: the admin role (when blocking, so
  // the last active admin is kept, R6), then the user row FOR UPDATE — a shared lock upgraded by
  // the UPDATE would deadlock against a concurrent change. Blocking ends the sessions (A2).
  @Transactional()
  private async applyChanges(
    actor: AuthUser,
    userId: string,
    patch: ProfilePatch,
  ): Promise<User> {
    if (patch.status === 'blocked') await this.rbacAdmin.lockAdminRole();
    const user = (await this.users.lockForUpdate(userId)) ?? notFound();
    // Under the user lock, so a concurrent grant of admin rights cannot slip past (P7); before
    // the last-admin count, so a refused caller learns nothing about the target.
    if (
      actor.id !== userId &&
      (patch.email !== undefined || patch.status !== undefined)
    ) {
      await this.assertMayTakeOver(actor, userId);
    }
    if (patch.status === 'blocked') {
      await this.rbacAdmin.assertAnotherActiveAdmin(userId);
    }
    const updated = await this.users.update(userId, patch);
    if (patch.email !== undefined && patch.email !== user.email) {
      await this.auth.afterAdminEmailChange(userId, user.email);
    }
    return updated;
  }

  // Inside storeWithin's transaction: the old photo's row goes now, its object after commit.
  private async linkPhoto(userId: string, fileId: string): Promise<User> {
    const user = (await this.users.lockForUpdate(userId)) ?? notFound();
    await this.users.setPhoto(userId, fileId);
    if (user.photoFileId) await this.files.remove(user.photoFileId);
    return (await this.users.findById(userId)) ?? notFound();
  }

  @Transactional()
  private async unlinkPhoto(userId: string): Promise<void> {
    const user = (await this.users.lockForUpdate(userId)) ?? notFound();
    if (!user.photoFileId) return;
    await this.users.setPhoto(userId, null);
    await this.files.remove(user.photoFileId);
  }
}
