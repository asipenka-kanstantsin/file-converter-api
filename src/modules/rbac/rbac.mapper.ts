import type {
  GrantResponse,
  PermissionResponse,
  RoleResponse,
} from './dto/rbac.dto';
import { isSystemPermission } from './rbac-admin.service';
import {
  type Grant,
  type Permission,
  type Role,
  SYSTEM_ROLES,
} from './rbac.types';

export function toRoleResponse(role: Role): RoleResponse {
  return { ...role, system: SYSTEM_ROLES.has(role.name) };
}

export function toPermissionResponse(
  permission: Permission,
): PermissionResponse {
  return { ...permission, system: isSystemPermission(permission.name) };
}

export function toGrantResponse(grant: Grant, system: boolean): GrantResponse {
  return { ...grant, system };
}
