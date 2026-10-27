import { Transactional } from '@nestjs-cls/transactional';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { PERMISSIONS } from '@/common/decorators';

import { RbacRepository } from './rbac.repository';
import { ADMIN_ROLE, type RbacConfiguration, USER_ROLE } from './rbac.types';

// 'all' = a grant without actions: every action of the permission (Notion "RBAC" 1.3.1 step 4).
type GrantedActions = 'all' | ReadonlySet<string>;

interface Snapshot {
  // The grant the system keeps (R6): admin → rbac with every action.
  adminRoleId: string | undefined;
  // role id → permission name → granted actions
  grants: ReadonlyMap<string, ReadonlyMap<string, GrantedActions>>;
  // permission name → its actions
  permissions: ReadonlyMap<string, ReadonlySet<string>>;
  rbacPermissionId: string | undefined;
  userRoleId: string | undefined;
}

const EMPTY: Snapshot = {
  adminRoleId: undefined,
  grants: new Map(),
  permissions: new Map(),
  rbacPermissionId: undefined,
  userRoleId: undefined,
};

// Retries back off from 1 s to 1 min; only the first failure of a streak is an error.
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 60_000;

function sameActions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((action) => b.includes(action));
}

export function buildSnapshot(config: RbacConfiguration): Snapshot {
  const permissions = new Map(
    config.permissions.map((p) => [p.name, new Set(p.actions)] as const),
  );
  const nameById = new Map(config.permissions.map((p) => [p.id, p.name]));
  const grants = new Map<string, Map<string, GrantedActions>>();
  for (const grant of config.grants) {
    const name = nameById.get(grant.permissionId);
    if (name === undefined) continue;
    const ofRole =
      grants.get(grant.roleId) ?? new Map<string, GrantedActions>();
    ofRole.set(
      name,
      grant.actions.length === 0 ? 'all' : new Set(grant.actions),
    );
    grants.set(grant.roleId, ofRole);
  }
  const roleId = (name: string): string | undefined =>
    config.roles.find((role) => role.name === name)?.id;
  return {
    adminRoleId: roleId(ADMIN_ROLE),
    grants,
    permissions,
    rbacPermissionId: config.permissions.find((p) => p.name === 'rbac')?.id,
    userRoleId: roleId(USER_ROLE),
  };
}

// Notion "RBAC": the configuration lives in the DB, is loaded at startup and reloaded after
// every change, without a restart (decision R1). Single instance: no cross-process invalidation.
@Injectable()
export class RbacService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(RbacService.name);
  private snapshot: Snapshot = EMPTY;
  private reloading: Promise<void> = Promise.resolve();
  private retry: NodeJS.Timeout | undefined;
  private retryDelay = RETRY_FIRST_MS;
  private failures = 0;
  private stopped = false;

  constructor(private readonly repository: RbacRepository) {}

  // The app must come up with the database down (health answers 503 meanwhile): until the
  // configuration loads, every permission check is denied and loading is retried.
  async onModuleInit(): Promise<void> {
    await this.attempt('startup', () => this.initialize());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.retry = undefined;
  }

  async initialize(): Promise<void> {
    await this.ensureSystemConfiguration();
    await this.reload('startup');
  }

  // Notion "RBAC" 1.3.1. Unknown permissions, actions and roles never grant anything.
  can(roleIds: readonly string[], permission: string, action: string): boolean {
    const { grants, permissions, userRoleId } = this.snapshot;
    if (!permissions.get(permission)?.has(action)) return false;
    const roles = userRoleId === undefined ? roleIds : [...roleIds, userRoleId];
    return roles.some((roleId) => {
      const granted = grants.get(roleId)?.get(permission);
      return granted === 'all' || (granted?.has(action) ?? false);
    });
  }

  // Decision P7: an actor may only take over an account whose rights it already holds in full.
  // Checking one permission (rbac@manage) left every other privileged account — settings, user
  // administration — open to anyone holding users@update.
  covers(
    actorRoleIds: readonly string[],
    targetRoleIds: readonly string[],
  ): boolean {
    for (const [permission, actions] of this.effective(targetRoleIds)) {
      for (const action of actions) {
        if (!this.can(actorRoleIds, permission, action)) return false;
      }
    }
    return true;
  }

  isProtectedGrant(grant: { permissionId: string; roleId: string }): boolean {
    const { adminRoleId, rbacPermissionId } = this.snapshot;
    return (
      grant.roleId === adminRoleId && grant.permissionId === rbacPermissionId
    );
  }

  // Every permission and action these roles grant, with 'all' expanded to the actions the code
  // declares — an unknown permission grants nothing, as in `can`.
  private effective(roleIds: readonly string[]): Map<string, Set<string>> {
    const { grants, permissions } = this.snapshot;
    const effective = new Map<string, Set<string>>();
    for (const roleId of roleIds) {
      for (const [permission, granted] of grants.get(roleId) ?? []) {
        const declared = permissions.get(permission);
        if (!declared) continue;
        const actions = granted === 'all' ? declared : granted;
        const into = effective.get(permission) ?? new Set<string>();
        for (const action of actions) {
          if (declared.has(action)) into.add(action);
        }
        effective.set(permission, into);
      }
    }
    return effective;
  }

  // Reloads run one after another; each reads the DB afresh, so the last one always sees the
  // last committed change.
  reload(trigger: string): Promise<void> {
    const next = this.reloading
      .catch(() => undefined)
      .then(() => this.load(trigger));
    this.reloading = next;
    return next;
  }

  // After a committed admin change: a failed reload must not turn a saved change into a 500, so
  // it is logged and retried until it succeeds.
  async reloadAfterChange(trigger: string): Promise<void> {
    await this.attempt(trigger, () => this.reload(trigger));
  }

  // The permissions the code checks, the built-in roles and the protected admin grant
  // (decisions R3, R6). A permission new to the DB is granted to admin; an existing one only gets
  // its actions brought in line with the code.
  @Transactional()
  async ensureSystemConfiguration(): Promise<void> {
    await this.repository.ensureRoles([
      { description: 'Built in: full access.', name: ADMIN_ROLE },
      { description: 'Built in: every signed-in account.', name: USER_ROLE },
    ]);
    const admin = await this.repository.findRoleByName(ADMIN_ROLE);
    if (!admin) throw new Error('the admin role is missing');
    for (const [name, catalog] of Object.entries(PERMISSIONS)) {
      const actions: string[] = [...catalog];
      const existing = await this.repository.findPermissionByName(name);
      if (!existing) {
        const created = await this.repository.createPermission({
          actions,
          name,
        });
        await this.repository.createGrant({
          actions: [],
          permissionId: created.id,
          roleId: admin.id,
        });
      } else if (!sameActions(existing.actions, actions)) {
        await this.repository.updatePermission(existing.id, { actions, name });
        await this.pruneGrants(existing.id, actions);
      }
    }
    const rbac = await this.repository.findPermissionByName('rbac');
    if (!rbac) throw new Error('the rbac permission is missing');
    await this.repository.upsertGrant(admin.id, rbac.id);
  }

  private async load(trigger: string): Promise<void> {
    const config = await this.repository.loadConfiguration();
    this.snapshot = buildSnapshot(config);
    this.logger.log(
      {
        grants: config.grants.length,
        permissions: config.permissions.length,
        roles: config.roles.length,
        trigger,
      },
      'rbac configuration reloaded',
    );
  }

  // A code change dropped actions from a built-in permission: grants must not keep them (they
  // would come back to life if the action returned). A grant left with none is removed, since an
  // empty list would mean "every action".
  private async pruneGrants(
    permissionId: string,
    actions: readonly string[],
  ): Promise<void> {
    const kept = new Set(actions);
    for (const grant of await this.repository.grantsOfPermission(
      permissionId,
    )) {
      if (grant.actions.length === 0) continue;
      const remaining = grant.actions.filter((action) => kept.has(action));
      if (remaining.length === grant.actions.length) continue;
      if (remaining.length === 0) {
        await this.repository.deleteGrant(grant.id);
      } else {
        await this.repository.updateGrant(grant.id, {
          actions: remaining,
          permissionId: grant.permissionId,
          roleId: grant.roleId,
        });
      }
      this.logger.warn(
        {
          grantId: grant.id,
          removed: grant.actions.filter((a) => !kept.has(a)),
        },
        'grant lost actions its permission no longer has',
      );
    }
  }

  private async attempt(
    trigger: string,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task();
      this.failures = 0;
      this.retryDelay = RETRY_FIRST_MS;
    } catch (error: unknown) {
      this.failures += 1;
      const entry = { err: error, failures: this.failures, trigger };
      if (this.failures === 1) {
        this.logger.error(entry, 'rbac reload failed; retrying');
      } else {
        this.logger.warn(entry, 'rbac reload still failing; retrying');
      }
      this.scheduleRetry(trigger, task);
    }
  }

  private scheduleRetry(trigger: string, task: () => Promise<void>): void {
    if (this.retry || this.stopped) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(delay * 2, RETRY_MAX_MS);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.attempt(`${trigger} (retry)`, task);
    }, delay);
    this.retry.unref();
  }
}
