import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  type StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import { streamFile } from '@/common/http/streaming';
import { uuidSchema } from '@/common/validation';

import { DownloadsService, type SavedResult } from './downloads.service';
import { historyQuerySchema } from './history';
import { type HistoryPage, HistoryService } from './history.service';

class HistoryQueryDto extends createZodDto(historyQuerySchema) {}

class UserIdParamDto extends createZodDto(z.object({ userId: uuidSchema })) {}

class ItemParamDto extends createZodDto(z.object({ itemId: uuidSchema })) {}

class UserItemParamDto extends createZodDto(
  z.object({ itemId: uuidSchema, userId: uuidSchema }),
) {}

// Notion 1.3.2: `Content-Disposition: attachment; filename="<original-name>"`, streamed.
function attachment(result: SavedResult, response: Response): StreamableFile {
  return streamFile(
    result.body,
    {
      disposition: `attachment; filename="${result.filename}"`,
      length: result.size,
      type: result.mime,
    },
    response,
  );
}

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
  constructor(
    private readonly downloads: DownloadsService,
    private readonly history: HistoryService,
  ) {}

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

  // Notion "Сохранение результатов" 1.3.2: a saved result of one's own.
  @Get(':itemId/download')
  @RateLimit('profile')
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentUser() actor: AuthUser,
    @Param() { itemId }: ItemParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return attachment(await this.downloads.own(actor, itemId), response);
  }
}

@Controller('admin/users/:userId/transformations/history')
export class AdminHistoryController {
  constructor(
    private readonly downloads: DownloadsService,
    private readonly history: HistoryService,
  ) {}

  // 1.3.2: one user's history, for transformations@history.
  @Get()
  @RequirePermission('transformations', 'history')
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

  // Notion "Сохранение результатов" 1.3.3: any user's saved result, for transformations@download.
  @Get(':itemId/download')
  @RequirePermission('transformations', 'download')
  @RateLimit('profile')
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentUser() actor: AuthUser,
    @Param() { itemId, userId }: UserItemParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return attachment(
      await this.downloads.ofUser(actor, userId, itemId),
      response,
    );
  }
}
