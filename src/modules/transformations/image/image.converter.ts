import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { z } from 'zod';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';
import { SettingsService } from '@/modules/settings';

import { Converter } from '../converter';
import { LIBVIPS_BAD_INPUT } from './libvips-errors';
import { looksLikeSvg } from './svg-detect';
import { SvgRenderer } from './svg-renderer';

export type ImageFormat = 'jpeg' | 'png' | 'svg';

const FORMATS = ['jpeg', 'png', 'svg'] as const;

const MIME: Readonly<Record<ImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
};

// Decompression bombs (Notion 1.4, 1.6): a raster may not decode to more than this, whatever its
// file size says.
const MAX_INPUT_PIXELS = 50_000_000;
// Raster conversions at once on the libuv pool, which sign-ins (argon2) and storage share.
const MAX_RASTER_JOBS = 2;
const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_QUALITY = 85;

// Notion 1.3.1 `options`.
export const imageOptionsSchema = z
  .strictObject({
    background: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .optional(),
    height: z.number().int().min(1).max(16_384).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    width: z.number().int().min(1).max(16_384).optional(),
  })
  .default({});

export type ImageOptions = z.infer<typeof imageOptionsSchema>;

function invalid(code: ErrorCode, context?: Record<string, unknown>): never {
  throw new AppException(code, HttpStatus.BAD_REQUEST, context);
}

// Notion "Трансформация изображений": PNG ↔ JPEG and SVG → PNG/JPEG; never raster → SVG.
@Injectable()
export class ImageConverter extends Converter<ImageFormat> {
  readonly formats = FORMATS;
  readonly type = 'image' as const;
  protected readonly pairs = {
    jpeg: ['png'],
    png: ['jpeg'],
    svg: ['jpeg', 'png'],
  } as const satisfies Record<ImageFormat, readonly ImageFormat[]>;

  private readonly logger = new Logger(ImageConverter.name);
  private rasterJobs = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly renderer: SvgRenderer,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  // Magic bytes decide, never the name; for SVG, an <svg root element after an optional XML
  // declaration, comments and a DTD (refused later as unsafe rather than unknown).
  detect(input: Buffer): ImageFormat | undefined {
    if (
      input
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'png';
    }
    if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff)
      return 'jpeg';
    const head = new TextDecoder('utf-8').decode(input.subarray(0, 8192));
    return looksLikeSvg(head) ? 'svg' : undefined;
  }

  extensionOf(format: ImageFormat): string {
    return format === 'jpeg' ? 'jpg' : format;
  }

  mimeOf(format: ImageFormat): string {
    return MIME[format];
  }

  async convert(
    input: Buffer,
    source: ImageFormat,
    target: ImageFormat,
    raw: unknown,
  ): Promise<Buffer> {
    const options = imageOptionsSchema.parse(raw);
    if (target === 'svg') invalid(ErrorCode.CONVERSION_NOT_SUPPORTED);
    return source === 'svg'
      ? this.rasterise(input, target, options)
      : this.convertRaster(input, target, options);
  }

  private async convertRaster(
    input: Buffer,
    target: 'jpeg' | 'png',
    options: ImageOptions,
  ): Promise<Buffer> {
    if (this.rasterJobs >= MAX_RASTER_JOBS) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.rasterJobs += 1;
    try {
      // EXIF orientation applied, then dropped (a phone photo stays upright).
      const pipeline = sharp(input, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
      }).rotate();
      // A valid header with a broken body fails here, not half-way through the encode.
      await pipeline.metadata();
      const encoded =
        target === 'jpeg'
          ? pipeline
              .flatten({ background: options.background ?? DEFAULT_BACKGROUND })
              .jpeg({
                mozjpeg: true,
                quality: options.quality ?? DEFAULT_QUALITY,
              })
          : pipeline.png();
      return await encoded
        .timeout({
          seconds: Math.max(
            1,
            Math.ceil(this.config.conversion.timeoutMs / 1000),
          ),
        })
        .toBuffer();
    } catch (error: unknown) {
      throw this.rasterError(error);
    } finally {
      this.rasterJobs -= 1;
    }
  }

  private rasterError(error: unknown): Error {
    const message = error instanceof Error ? error.message : '';
    if (/timeout/i.test(message)) {
      return new AppException(
        ErrorCode.CONVERSION_TIMEOUT,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (/pixel limit/i.test(message)) {
      return new AppException(
        ErrorCode.IMAGE_TOO_LARGE,
        HttpStatus.BAD_REQUEST,
        {
          maxPixels: MAX_INPUT_PIXELS,
        },
      );
    }
    if (LIBVIPS_BAD_INPUT.test(message)) {
      return new AppException(
        ErrorCode.FILE_PARSE_ERROR,
        HttpStatus.BAD_REQUEST,
      );
    }
    this.logger.error({ err: error }, 'image conversion failed');
    return error instanceof Error
      ? error
      : new Error('image conversion failed');
  }

  // SVG → raster (F11): checked, sized and rendered in the child process; here only the limits
  // and options are handed over.
  private async rasterise(
    input: Buffer,
    target: 'jpeg' | 'png',
    options: ImageOptions,
  ): Promise<Buffer> {
    const limits = await this.settings.numbers([
      'convert.svg.maxHeight',
      'convert.svg.maxWidth',
    ]);
    return this.renderer.render({
      background: options.background ?? DEFAULT_BACKGROUND,
      height: options.height,
      input,
      maxHeight: limits['convert.svg.maxHeight'],
      maxWidth: limits['convert.svg.maxWidth'],
      quality: options.quality ?? DEFAULT_QUALITY,
      target,
      width: options.width,
    });
  }
}
