// Built-in roles (decisions R3, R5). `admin` holds every permission it is granted and is the
// only holder of rbac@manage that the system protects; `user` is implicit for every account.
export const ADMIN_ROLE = 'admin';
export const USER_ROLE = 'user';
export const SYSTEM_ROLES: ReadonlySet<string> = new Set([
  ADMIN_ROLE,
  USER_ROLE,
]);

export interface Role {
  createdAt: Date;
  description: null | string;
  id: string;
  name: string;
  updatedAt: Date;
}

export interface Permission {
  actions: string[];
  createdAt: Date;
  id: string;
  name: string;
  updatedAt: Date;
}

export interface Grant {
  actions: string[];
  createdAt: Date;
  id: string;
  permissionId: string;
  roleId: string;
  updatedAt: Date;
}

export interface RoleInput {
  description?: string | undefined;
  name: string;
}

export interface PermissionInput {
  actions: string[];
  name: string;
}

export interface GrantInput {
  actions: string[];
  permissionId: string;
  roleId: string;
}

// Everything the access check needs, read in one go.
export interface RbacConfiguration {
  grants: Grant[];
  permissions: Permission[];
  roles: Role[];
}
