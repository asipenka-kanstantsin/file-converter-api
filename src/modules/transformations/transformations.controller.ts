import { Readable } from 'node:stream';

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  type StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import { streamFile } from '@/common/http/streaming';
import { requireFile, SingleFileUpload } from '@/common/http/upload';

import { formatPairsSchema, saveFlagSchema } from './convert.dto';
import type { FormatPair } from './converter';
import { TextConverter } from './text/text.converter';
import { TransformationsService } from './transformations.service';

class ConvertFileDto extends createZodDto(
  z.strictObject({
    save: saveFlagSchema,
    targetFormat: z.enum(['csv', 'json', 'xml', 'yaml']),
  }),
) {}

class FormatPairsDto extends createZodDto(formatPairsSchema) {}

// Notion "Трансформация текстовых форматов" 1.3: any authenticated user.
@Controller('convert')
export class TransformationsController {
  constructor(
    private readonly text: TextConverter,
    private readonly transformations: TransformationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit('convert')
  @UseInterceptors(
    SingleFileUpload('file', (moduleRef) =>
      moduleRef
        .get(TransformationsService, { strict: false })
        .uploadLimit(moduleRef.get(TextConverter, { strict: false })),
    ),
  )
  @Header('Cache-Control', 'no-store')
  async convert(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() { save, targetFormat }: ConvertFileDto,
  ): Promise<StreamableFile> {
    const upload = requireFile(file);
    const result = await this.transformations.convert(actor, this.text, {
      filename: upload.originalname,
      input: upload.buffer,
      save,
      target: targetFormat,
    });
    return streamFile(Readable.from([result.body]), {
      disposition: `attachment; filename="${result.filename}"`,
      length: result.body.length,
      type: result.mime,
    });
  }

  @Get('formats')
  @ZodSerializerDto(FormatPairsDto)
  formats(): FormatPair[] {
    return this.text.listPairs();
  }
}
