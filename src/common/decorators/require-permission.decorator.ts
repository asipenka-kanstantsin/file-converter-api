import { type CustomDecorator, SetMetadata } from '@nestjs/common';

// Every permission the code checks, with its actions (decision R3). RbacService creates these at
// startup if missing; they are read-only through the admin API, so no route can lose its rule.
export const PERMISSIONS = {
  rbac: ['manage'],
  settings: ['manage'],
  transformations: ['download', 'history'],
  users: ['delete', 'list', 'read', 'update'],
} as const satisfies Record<string, readonly string[]>;

export type PermissionName = keyof typeof PERMISSIONS;
export type PermissionAction<P extends PermissionName> =
  (typeof PERMISSIONS)[P][number];

export interface RequiredPermission {
  action: string;
  permission: string;
}

export const PERMISSION_KEY = 'requiredPermission';

// Notion "RBAC" 1.3.1: the route names `permission@action`; PermissionGuard checks it against
// the cached configuration. On a controller it applies to every handler.
export const RequirePermission = <P extends PermissionName>(
  permission: P,
  action: PermissionAction<P>,
): CustomDecorator =>
  SetMetadata(PERMISSION_KEY, {
    action,
    permission,
  } satisfies RequiredPermission);
