import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  type StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import { requireFile, SingleFileUpload } from '@/common/http/upload';

import { formatPairsSchema, saveFlagSchema } from './convert.dto';
import { convertedFile } from './converted-file';
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const upload = requireFile(file);
    const result = await this.transformations.convert(actor, this.text, {
      filename: upload.originalname,
      input: upload.buffer,
      save,
      target: targetFormat,
    });
    return convertedFile(result, response);
  }

  @Get('formats')
  @ZodSerializerDto(FormatPairsDto)
  formats(): FormatPair[] {
    return this.text.listPairs();
  }
}
