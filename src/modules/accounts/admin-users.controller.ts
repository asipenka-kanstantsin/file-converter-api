import { Controller, Get, Header, Logger, Query } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import {
  type User,
  USER_LIST_SORTS,
  UsersService,
  userStatusSchema,
} from '@/modules/users';

const timestamp = z.date().transform((date) => date.toISOString());

// Notion 1.3.1 query; unknown parameters are refused (strict), so a typo is never ignored.
const listQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(USER_LIST_SORTS).default('created_at'),
  status: userStatusSchema.optional(),
});

class UserListQueryDto extends createZodDto(listQuerySchema) {}

// UserListItem (Notion 1.3.1): no hashes, tokens, versions or other internals (1.4).
const listItemSchema = z.object({
  createdAt: timestamp,
  email: z.string(),
  id: z.string(),
  lastLoginAt: timestamp.nullable(),
  photo: z.string().nullable(),
  status: userStatusSchema,
});

class UserListDto extends createZodDto(
  z.object({
    items: z.array(listItemSchema),
    nextCursor: z.string().nullable(),
  }),
) {}

type ListItem = z.input<typeof listItemSchema>;

function toListItem(user: User): ListItem {
  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    lastLoginAt: user.lastLoginAt,
    photo: user.photoFileId ? `/api/users/${user.id}/photo` : null,
    status: user.status,
  };
}

// Notion "Просмотр списка всех пользователей" (H5: GET /api/admin/users), permission users@list.
@Controller('admin/users')
@RequirePermission('users', 'list')
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(private readonly users: UsersService) {}

  @Get()
  @RateLimit('profile')
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(UserListDto)
  async list(
    @CurrentUser() actor: AuthUser,
    @Query() query: UserListQueryDto,
  ): Promise<{ items: ListItem[]; nextCursor: null | string }> {
    const page = await this.users.list(query);
    // Notion 1.5: actor, parameters without PII (the search text only by length), count.
    this.logger.log(
      {
        actorUserId: actor.id,
        count: page.items.length,
        cursor: query.cursor !== undefined,
        limit: query.limit,
        order: query.order,
        qLength: query.q?.length,
        result: 200,
        sort: query.sort,
        status: query.status,
      },
      'user list viewed',
    );
    return { items: page.items.map(toListItem), nextCursor: page.nextCursor };
  }
}
