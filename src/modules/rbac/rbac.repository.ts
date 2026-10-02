import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { PrismaService } from '@/infrastructure/database';

import type {
  Grant,
  GrantInput,
  Permission,
  PermissionInput,
  RbacConfiguration,
  Role,
  RoleInput,
} from './rbac.types';

const byName = { name: 'asc' } as const;

// Raw locking reads return ids only; the typed row is then read through Prisma (07: parse raw
// results with zod).
const lockedIdsSchema = z.array(z.object({ id: z.string() }));

@Injectable()
export class RbacRepository {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  private get db(): TransactionHost<
    TransactionalAdapterPrisma<PrismaService>
  >['tx'] {
    return this.txHost.tx;
  }

  // One snapshot of the three tables, never half of a concurrent change.
  loadConfiguration(): Promise<RbacConfiguration> {
    return this.txHost.withTransaction(
      { isolationLevel: 'RepeatableRead' },
      async () => {
        const roles = await this.db.role.findMany({ orderBy: byName });
        const permissions = await this.db.permission.findMany({
          orderBy: byName,
        });
        const grants = await this.db.grant.findMany({
          orderBy: { createdAt: 'asc' },
        });
        return { grants, permissions, roles };
      },
    );
  }

  // Roles

  findRole(id: string): Promise<null | Role> {
    return this.db.role.findUnique({ where: { id } });
  }

  findRoleByName(name: string): Promise<null | Role> {
    return this.db.role.findUnique({ where: { name } });
  }

  // FOR SHARE: the roles cannot be deleted until this transaction ends, so the grant or user-role
  // rows written next cannot hit a vanished role. Locked in id order against deadlocks.
  async lockRolesForShare(ids: readonly string[]): Promise<Role[]> {
    if (ids.length === 0) return [];
    const rows = lockedIdsSchema.parse(
      await this.db.$queryRaw`
        SELECT id FROM roles WHERE id = ANY(${[...ids]}::uuid[]) ORDER BY id FOR SHARE`,
    );
    return this.db.role.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
  }

  createRole(input: RoleInput): Promise<Role> {
    return this.db.role.create({
      data: { description: input.description ?? null, name: input.name },
    });
  }

  // Idempotent: concurrent startups may both try.
  async ensureRoles(roles: readonly RoleInput[]): Promise<void> {
    await this.db.role.createMany({
      data: roles.map((role) => ({
        description: role.description ?? null,
        name: role.name,
      })),
      skipDuplicates: true,
    });
  }

  updateRole(id: string, input: RoleInput): Promise<Role> {
    return this.db.role.update({
      data: { description: input.description ?? null, name: input.name },
      where: { id },
    });
  }

  async deleteRole(id: string): Promise<void> {
    await this.db.role.delete({ where: { id } });
  }

  // FOR UPDATE: the role cannot change or vanish under this transaction. On `admin` it also
  // serialises every change of who holds it, so two admins cannot demote each other at once.
  async lockRole(id: string): Promise<null | Role> {
    const rows = lockedIdsSchema.parse(
      await this.db
        .$queryRaw`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`,
    );
    return rows.length === 0 ? null : this.findRole(id);
  }

  // Permissions

  findPermission(id: string): Promise<null | Permission> {
    return this.db.permission.findUnique({ where: { id } });
  }

  findPermissionByName(name: string): Promise<null | Permission> {
    return this.db.permission.findUnique({ where: { name } });
  }

  // Grant writes and permission updates lock the permission row, so a grant can never end up
  // with an action its permission no longer has.
  async lockPermission(id: string): Promise<null | Permission> {
    const rows = lockedIdsSchema.parse(
      await this.db.$queryRaw`
        SELECT id FROM permissions WHERE id = ${id}::uuid FOR UPDATE`,
    );
    return rows.length === 0 ? null : this.findPermission(id);
  }

  createPermission(input: PermissionInput): Promise<Permission> {
    return this.db.permission.create({
      data: { actions: input.actions, name: input.name },
    });
  }

  updatePermission(id: string, input: PermissionInput): Promise<Permission> {
    return this.db.permission.update({
      data: { actions: input.actions, name: input.name },
      where: { id },
    });
  }

  async deletePermission(id: string): Promise<void> {
    await this.db.permission.delete({ where: { id } });
  }

  // Grants

  findGrant(id: string): Promise<Grant | null> {
    return this.db.grant.findUnique({ where: { id } });
  }

  // NO KEY UPDATE, not UPDATE: deleting the grant's role or permission takes FOR KEY SHARE on
  // it for the RESTRICT check, and FOR UPDATE would deadlock with that.
  async lockGrant(id: string): Promise<Grant | null> {
    const rows = lockedIdsSchema.parse(
      await this.db
        .$queryRaw`SELECT id FROM grants WHERE id = ${id}::uuid FOR NO KEY UPDATE`,
    );
    return rows.length === 0 ? null : this.findGrant(id);
  }

  findGrantFor(roleId: string, permissionId: string): Promise<Grant | null> {
    return this.db.grant.findUnique({
      where: { roleId_permissionId: { permissionId, roleId } },
    });
  }

  grantsOfPermission(permissionId: string): Promise<Grant[]> {
    return this.db.grant.findMany({ where: { permissionId } });
  }

  createGrant(input: GrantInput): Promise<Grant> {
    return this.db.grant.create({ data: input });
  }

  updateGrant(id: string, input: GrantInput): Promise<Grant> {
    return this.db.grant.update({ data: input, where: { id } });
  }

  // Used at startup for the protected admin grant: whatever it was, it becomes "all actions".
  async upsertGrant(roleId: string, permissionId: string): Promise<void> {
    await this.db.grant.upsert({
      create: { actions: [], permissionId, roleId },
      update: { actions: [] },
      where: { roleId_permissionId: { permissionId, roleId } },
    });
  }

  async deleteGrant(id: string): Promise<void> {
    await this.db.grant.delete({ where: { id } });
  }

  // User roles

  async roleIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db.userRole.findMany({
      orderBy: { createdAt: 'asc' },
      select: { roleId: true },
      where: { userId },
    });
    return rows.map((row) => row.roleId);
  }

  async replaceUserRoles(
    userId: string,
    roleIds: readonly string[],
  ): Promise<void> {
    await this.db.userRole.deleteMany({ where: { userId } });
    if (roleIds.length > 0) {
      await this.db.userRole.createMany({
        data: roleIds.map((roleId) => ({ roleId, userId })),
      });
    }
  }

  async addUserRole(userId: string, roleId: string): Promise<void> {
    await this.db.userRole.createMany({
      data: [{ roleId, userId }],
      skipDuplicates: true,
    });
  }

  // Only accounts that can sign in count as holders (R6).
  countActiveRoleHolders(roleId: string): Promise<number> {
    return this.db.userRole.count({
      where: { roleId, user: { status: 'active' } },
    });
  }
}
