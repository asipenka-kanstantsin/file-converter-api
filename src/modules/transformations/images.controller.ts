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
import { ImageConverter, imageOptionsSchema } from './image/image.converter';
import { TransformationsService } from './transformations.service';

// Notion 1.3.1 `options` is an object; in multipart it arrives as one JSON field.
const optionsFieldSchema = z
  .string()
  .max(1000)
  .optional()
  .transform((text, ctx) => {
    if (text === undefined) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'invalid_json' });
      return z.NEVER;
    }
  })
  .pipe(imageOptionsSchema);

class ConvertImageDto extends createZodDto(
  z.strictObject({
    options: optionsFieldSchema,
    save: saveFlagSchema,
    targetFormat: z.enum(['jpeg', 'png', 'svg']),
  }),
) {}

class FormatPairsDto extends createZodDto(formatPairsSchema) {}

// Notion "Трансформация изображений" 1.3: any authenticated user.
@Controller('images/convert')
export class ImagesController {
  constructor(
    private readonly images: ImageConverter,
    private readonly transformations: TransformationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit('convert')
  @UseInterceptors(
    SingleFileUpload('file', (moduleRef) =>
      moduleRef
        .get(TransformationsService, { strict: false })
        .uploadLimit(moduleRef.get(ImageConverter, { strict: false })),
    ),
  )
  @Header('Cache-Control', 'no-store')
  async convert(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() { options, save, targetFormat }: ConvertImageDto,
  ): Promise<StreamableFile> {
    const upload = requireFile(file);
    const result = await this.transformations.convert(actor, this.images, {
      filename: upload.originalname,
      input: upload.buffer,
      options,
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
    return this.images.listPairs();
  }
}
