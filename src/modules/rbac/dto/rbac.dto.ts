import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { uuidSchema } from '@/common/validation';

// Notion "RBAC" 1.4 "Невалидный формат действия или разрешения" → 400 VALIDATION_FAILED.
const roleNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/);
const permissionNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/);
const actionSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);

function uniqueList<T extends z.ZodType>(item: T, min: number): z.ZodArray<T> {
  return z
    .array(item)
    .min(min)
    .max(32)
    .refine((items) => new Set(items).size === items.length, {
      message: 'duplicate',
    });
}

const actionsSchema = (min: number): z.ZodArray<typeof actionSchema> =>
  uniqueList(actionSchema, min);

// Requests

export const roleInputSchema = z.object({
  description: z.string().trim().max(500).optional(),
  name: roleNameSchema,
});

export const permissionInputSchema = z.object({
  actions: actionsSchema(1),
  name: permissionNameSchema,
});

// Notion "RBAC" 1.3.4: no or empty actions = every action of the permission.
export const grantInputSchema = z.object({
  actions: actionsSchema(0).default([]),
  permissionId: uuidSchema,
  roleId: uuidSchema,
});

export const userRolesInputSchema = z.object({
  roleIds: uniqueList(uuidSchema, 0),
});

export class RoleInputDto extends createZodDto(roleInputSchema) {}
export class PermissionInputDto extends createZodDto(permissionInputSchema) {}
export class GrantInputDto extends createZodDto(grantInputSchema) {}
export class UserRolesInputDto extends createZodDto(userRolesInputSchema) {}

export class RoleIdParamDto extends createZodDto(
  z.object({ roleId: uuidSchema }),
) {}
export class PermissionIdParamDto extends createZodDto(
  z.object({ permissionId: uuidSchema }),
) {}
export class GrantIdParamDto extends createZodDto(
  z.object({ grantId: uuidSchema }),
) {}
export class UserIdParamDto extends createZodDto(
  z.object({ userId: uuidSchema }),
) {}

// Responses

const timestamp = z.date().transform((date) => date.toISOString());

export const roleSchema = z.object({
  createdAt: timestamp,
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  system: z.boolean(),
  updatedAt: timestamp,
});

export const permissionSchema = z.object({
  actions: z.array(z.string()),
  createdAt: timestamp,
  id: z.string(),
  name: z.string(),
  system: z.boolean(),
  updatedAt: timestamp,
});

export const grantSchema = z.object({
  actions: z.array(z.string()),
  createdAt: timestamp,
  id: z.string(),
  permissionId: z.string(),
  roleId: z.string(),
  system: z.boolean(),
  updatedAt: timestamp,
});

export type RoleResponse = z.input<typeof roleSchema>;
export type PermissionResponse = z.input<typeof permissionSchema>;
export type GrantResponse = z.input<typeof grantSchema>;

export class RoleEnvelopeDto extends createZodDto(
  z.object({ role: roleSchema }),
) {}
export class RoleListDto extends createZodDto(
  z.object({ items: z.array(roleSchema) }),
) {}
export class PermissionEnvelopeDto extends createZodDto(
  z.object({ permission: permissionSchema }),
) {}
export class PermissionListDto extends createZodDto(
  z.object({ items: z.array(permissionSchema) }),
) {}
export class GrantEnvelopeDto extends createZodDto(
  z.object({ grant: grantSchema }),
) {}
export class GrantListDto extends createZodDto(
  z.object({ items: z.array(grantSchema) }),
) {}
export class UserRolesDto extends createZodDto(
  z.object({ roleIds: z.array(z.string()), userId: z.string() }),
) {}
