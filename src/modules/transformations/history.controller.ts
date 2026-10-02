import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import { uuidSchema } from '@/common/validation';

import { historyQuerySchema } from './history';
import { type HistoryPage, HistoryService } from './history.service';

class HistoryQueryDto extends createZodDto(historyQuerySchema) {}

class UserIdParamDto extends createZodDto(z.object({ userId: uuidSchema })) {}

const timestamp = z.date().transform((date) => date.toISOString());

// TransformationHistoryItem (Notion 1.3.1), plus `downloadable` (FC-13): no e-mail or other
// personal data of anyone (1.4).
const itemSchema = z.object({
  createdAt: timestamp,
  downloadable: z.boolean(),
  durationMs: z.number(),
  errorCode: z.string().nullable(),
  fileSize: z.number(),
  id: z.string(),
  sourceFormat: z.string().nullable(),
  status: z.enum(['error', 'success']),
  targetFormat: z.string(),
  type: z.enum(['file', 'image']),
});

class HistoryPageDto extends createZodDto(
  z.object({ items: z.array(itemSchema), nextCursor: z.string().nullable() }),
) {}

@Controller('transformations/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  // 1.3.1: one's own history; the user id comes from the session.
  @Get()
  @RateLimit('profile')
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(HistoryPageDto)
  own(
    @CurrentUser() actor: AuthUser,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryPage> {
    return this.history.own(actor, query);
  }
}

@Controller('admin/users/:userId/transformations/history')
@RequirePermission('transformations', 'history')
export class AdminHistoryController {
  constructor(private readonly history: HistoryService) {}

  // 1.3.2: one user's history, for transformations@history.
  @Get()
  @RateLimit('profile')
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(HistoryPageDto)
  ofUser(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryPage> {
    return this.history.ofUser(actor, userId, query);
  }
}
