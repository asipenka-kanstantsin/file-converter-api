import { Transactional } from '@nestjs-cls/transactional';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { type AuthUser, PERMISSIONS } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
import { mapPrismaException } from '@/infrastructure/database';
import { UsersService } from '@/modules/users';

import { RbacRepository } from './rbac.repository';
import { RbacService } from './rbac.service';
import {
  ADMIN_ROLE,
  type Grant,
  type GrantInput,
  type Permission,
  type PermissionInput,
  type RbacConfiguration,
  type Role,
  type RoleInput,
  SYSTEM_ROLES,
  USER_ROLE,
} from './rbac.types';

type Operation = 'create' | 'delete' | 'update';
type Entity = 'grant' | 'permission' | 'role' | 'user_roles';
type AuditDetails = Record<string, unknown>;

const SUCCESS: Record<Operation, number> = {
  create: HttpStatus.CREATED,
  delete: HttpStatus.NO_CONTENT,
  update: HttpStatus.OK,
};

export function isSystemPermission(name: string): boolean {
  return Object.hasOwn(PERMISSIONS, name);
}

function notFound(code: ErrorCode, context?: Record<string, unknown>): never {
  throw new AppException(code, HttpStatus.NOT_FOUND, context);
}

function conflict(code: ErrorCode, context?: Record<string, unknown>): never {
  throw new AppException(code, HttpStatus.CONFLICT, context);
}

// What the client will receive, for the audit log: the domain error or the mapped DB refusal.
function failure(error: unknown): { code?: string; result: number } {
  if (error instanceof AppException) {
    return { code: error.code, result: error.status };
  }
  const mapped = mapPrismaException(error);
  return mapped
    ? { code: mapped.code, result: mapped.status }
    : { result: HttpStatus.INTERNAL_SERVER_ERROR };
}

function idOf(result: unknown): unknown {
  return typeof result === 'object' && result !== null && 'id' in result
    ? result.id
    : undefined;
}

// Admin management of roles, permissions, grants and user roles (Notion "RBAC" 1.3.2–1.3.4).
// Every write runs in one transaction that first locks the rows it depends on, so a concurrent
// change waits instead of turning into a 500; then the cache reloads (R1). Guard rails (R6):
// built-in roles and the permissions the code checks cannot be renamed or deleted, admin → rbac
// cannot be removed, rbac cannot go to the implicit user role, and the last active admin keeps
// the admin role.
@Injectable()
export class RbacAdminService {
  private readonly logger = new Logger(RbacAdminService.name);

  constructor(
    private readonly rbac: RbacService,
    private readonly repository: RbacRepository,
    private readonly users: UsersService,
  ) {}

  list(): Promise<RbacConfiguration> {
    return this.repository.loadConfiguration();
  }

  // Roles

  createRole(actor: AuthUser, input: RoleInput): Promise<Role> {
    return this.audit(actor, 'create', 'role', {}, () =>
      this.repository.createRole(input),
    );
  }

  updateRole(actor: AuthUser, id: string, input: RoleInput): Promise<Role> {
    return this.audit(actor, 'update', 'role', { entityId: id }, () =>
      this.updateRoleInTx(id, input),
    );
  }

  deleteRole(actor: AuthUser, id: string): Promise<void> {
    return this.audit(actor, 'delete', 'role', { entityId: id }, () =>
      this.deleteRoleInTx(id),
    );
  }

  // Permissions

  createPermission(
    actor: AuthUser,
    input: PermissionInput,
  ): Promise<Permission> {
    return this.audit(actor, 'create', 'permission', {}, () =>
      this.repository.createPermission(input),
    );
  }

  updatePermission(
    actor: AuthUser,
    id: string,
    input: PermissionInput,
  ): Promise<Permission> {
    return this.audit(actor, 'update', 'permission', { entityId: id }, () =>
      this.updatePermissionInTx(id, input),
    );
  }

  deletePermission(actor: AuthUser, id: string): Promise<void> {
    return this.audit(actor, 'delete', 'permission', { entityId: id }, () =>
      this.deletePermissionInTx(id),
    );
  }

  // Grants

  createGrant(actor: AuthUser, input: GrantInput): Promise<Grant> {
    return this.audit(
      actor,
      'create',
      'grant',
      { permissionId: input.permissionId, roleId: input.roleId },
      () => this.writeGrant(undefined, input),
    );
  }

  updateGrant(actor: AuthUser, id: string, input: GrantInput): Promise<Grant> {
    return this.audit(
      actor,
      'update',
      'grant',
      { entityId: id, permissionId: input.permissionId, roleId: input.roleId },
      () => this.writeGrant(id, input),
    );
  }

  deleteGrant(actor: AuthUser, id: string): Promise<void> {
    return this.audit(actor, 'delete', 'grant', { entityId: id }, () =>
      this.deleteGrantInTx(id),
    );
  }

  // User roles

  async userRoles(userId: string): Promise<string[]> {
    if (!(await this.users.findById(userId))) {
      notFound(ErrorCode.USER_NOT_FOUND);
    }
    return this.repository.roleIdsOf(userId);
  }

  setUserRoles(
    actor: AuthUser,
    userId: string,
    roleIds: readonly string[],
  ): Promise<string[]> {
    return this.audit(
      actor,
      'update',
      'user_roles',
      { roleIds, targetUserId: userId },
      () => this.setUserRolesInTx(userId, roleIds),
    );
  }

  // Bootstrap of the first admin from the command line (decision R7); idempotent. The reload
  // after the transaction refreshes this process only; the server reads user roles per request.
  async grantAdminByEmail(email: string): Promise<string> {
    const userId = await this.grantAdminInTx(email);
    this.logger.log(
      { targetUserId: userId },
      'admin role granted from the command line',
    );
    await this.rbac.reloadAfterChange('cli');
    return userId;
  }

  @Transactional()
  private async grantAdminInTx(email: string): Promise<string> {
    const credentials = await this.users.findCredentialsByEmail(email);
    if (!credentials) notFound(ErrorCode.USER_NOT_FOUND);
    const user = await this.users.lockForShare(credentials.user.id);
    if (!user) notFound(ErrorCode.USER_NOT_FOUND);
    if (user.status !== 'active') conflict(ErrorCode.USER_NOT_ACTIVE);
    const admin = await this.requireAdminRole();
    await this.repository.addUserRole(user.id, admin.id);
    return user.id;
  }

  @Transactional()
  private async updateRoleInTx(id: string, input: RoleInput): Promise<Role> {
    const role =
      (await this.repository.lockRole(id)) ??
      notFound(ErrorCode.RBAC_ROLE_NOT_FOUND);
    if (SYSTEM_ROLES.has(role.name) && input.name !== role.name) {
      conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    }
    return this.repository.updateRole(id, input);
  }

  @Transactional()
  private async deleteRoleInTx(id: string): Promise<void> {
    const role =
      (await this.repository.lockRole(id)) ??
      notFound(ErrorCode.RBAC_ROLE_NOT_FOUND);
    if (SYSTEM_ROLES.has(role.name)) conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    // Grants or users still holding the role: the foreign key refuses (R4) → RBAC_IN_USE.
    await this.repository.deleteRole(id);
  }

  @Transactional()
  private async updatePermissionInTx(
    id: string,
    input: PermissionInput,
  ): Promise<Permission> {
    const permission =
      (await this.repository.lockPermission(id)) ??
      notFound(ErrorCode.RBAC_PERMISSION_NOT_FOUND);
    if (isSystemPermission(permission.name)) {
      conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    }
    const kept = new Set(input.actions);
    const inUse = (await this.repository.grantsOfPermission(id))
      .flatMap((grant) => grant.actions)
      .filter((action) => !kept.has(action));
    if (inUse.length > 0) {
      conflict(ErrorCode.RBAC_ACTION_IN_USE, {
        actions: [...new Set(inUse)].sort(),
      });
    }
    return this.repository.updatePermission(id, input);
  }

  @Transactional()
  private async deletePermissionInTx(id: string): Promise<void> {
    const permission =
      (await this.repository.lockPermission(id)) ??
      notFound(ErrorCode.RBAC_PERMISSION_NOT_FOUND);
    if (isSystemPermission(permission.name)) {
      conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    }
    await this.repository.deletePermission(id);
  }

  // Lock order everywhere: grant, role (share), permission.
  @Transactional()
  private async writeGrant(
    id: string | undefined,
    input: GrantInput,
  ): Promise<Grant> {
    if (id !== undefined) {
      const grant =
        (await this.repository.lockGrant(id)) ??
        notFound(ErrorCode.RBAC_GRANT_NOT_FOUND);
      const unchangedTarget =
        grant.roleId === input.roleId &&
        grant.permissionId === input.permissionId;
      if (
        (await this.isProtectedGrant(grant)) &&
        !(unchangedTarget && input.actions.length === 0)
      ) {
        conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
      }
    }
    const [role] = await this.repository.lockRolesForShare([input.roleId]);
    if (!role) notFound(ErrorCode.RBAC_ROLE_NOT_FOUND);
    const permission =
      (await this.repository.lockPermission(input.permissionId)) ??
      notFound(ErrorCode.RBAC_PERMISSION_NOT_FOUND);
    // rbac on the implicit role would make every account an admin.
    if (role.name === USER_ROLE && permission.name === 'rbac') {
      conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    }
    const allowed = new Set(permission.actions);
    const unknown = input.actions.filter((action) => !allowed.has(action));
    if (unknown.length > 0) {
      throw new AppException(
        ErrorCode.RBAC_ACTION_NOT_ALLOWED,
        HttpStatus.BAD_REQUEST,
        { actions: unknown },
      );
    }
    // A duplicate role + permission is refused by the unique index → RBAC_GRANT_DUPLICATE.
    return id === undefined
      ? this.repository.createGrant(input)
      : this.repository.updateGrant(id, input);
  }

  @Transactional()
  private async deleteGrantInTx(id: string): Promise<void> {
    const grant =
      (await this.repository.lockGrant(id)) ??
      notFound(ErrorCode.RBAC_GRANT_NOT_FOUND);
    if (await this.isProtectedGrant(grant)) {
      conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    }
    await this.repository.deleteGrant(id);
  }

  // Lock order: admin role (update), then the user (share), then the listed roles (share).
  @Transactional()
  private async setUserRolesInTx(
    userId: string,
    roleIds: readonly string[],
  ): Promise<string[]> {
    const admin = await this.requireAdminRole();
    await this.repository.lockRole(admin.id);
    const user =
      (await this.users.lockForShare(userId)) ??
      notFound(ErrorCode.USER_NOT_FOUND);
    // A pending account cannot sign in; as an admin it would hide that nobody active is left.
    if (user.status !== 'active' && roleIds.length > 0) {
      conflict(ErrorCode.USER_NOT_ACTIVE);
    }
    const roles = await this.repository.lockRolesForShare(roleIds);
    const found = new Set(roles.map((role) => role.id));
    const missing = roleIds.find((roleId) => !found.has(roleId));
    if (missing !== undefined) {
      notFound(ErrorCode.RBAC_ROLE_NOT_FOUND, { roleId: missing });
    }
    if (roles.some((role) => role.name === USER_ROLE)) {
      conflict(ErrorCode.RBAC_SYSTEM_ENTITY);
    }
    await this.repository.replaceUserRoles(userId, roleIds);
    if ((await this.repository.countActiveRoleHolders(admin.id)) === 0) {
      conflict(ErrorCode.RBAC_LAST_ADMIN);
    }
    return this.repository.roleIdsOf(userId);
  }

  private async requireAdminRole(): Promise<Role> {
    const admin = await this.repository.findRoleByName(ADMIN_ROLE);
    if (!admin) throw new Error('the admin role is missing');
    return admin;
  }

  private async isProtectedGrant(grant: Grant): Promise<boolean> {
    const [role, permission] = await Promise.all([
      this.repository.findRole(grant.roleId),
      this.repository.findPermission(grant.permissionId),
    ]);
    return role?.name === ADMIN_ROLE && permission?.name === 'rbac';
  }

  // Notion "RBAC" 1.5: actorUserId, operation, entity, result — for refusals too — plus the ids
  // involved, so a change of privileges can be traced. Ids only, no personal data. The cache
  // reload is logged by RbacService.
  private async audit<T>(
    actor: AuthUser,
    operation: Operation,
    entity: Entity,
    details: AuditDetails,
    change: () => Promise<T>,
  ): Promise<T> {
    const base = { actorUserId: actor.id, entity, operation, ...details };
    let result: T;
    try {
      result = await change();
    } catch (error: unknown) {
      this.logger.warn({ ...base, ...failure(error) }, 'rbac change refused');
      throw error;
    }
    this.logger.log(
      {
        ...base,
        entityId: details.entityId ?? idOf(result),
        result: SUCCESS[operation],
      },
      'rbac changed',
    );
    await this.rbac.reloadAfterChange(`${entity} ${operation}`);
    return result;
  }
}
