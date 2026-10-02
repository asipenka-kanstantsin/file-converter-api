import { HttpStatus } from '@nestjs/common';
import sharp from 'sharp';

import { AppException, ErrorCode } from '@/common/errors';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1024;
// Decompression-bomb guard: a 5 MB PNG can still claim a huge canvas.
const MAX_INPUT_PIXELS = 40_000_000;

const OUTPUT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
} as const;

export interface ProcessedPhoto {
  body: Buffer;
  mime: (typeof OUTPUT)[keyof typeof OUTPUT];
}

function unsupported(): never {
  throw new AppException(
    ErrorCode.FILE_TYPE_NOT_SUPPORTED,
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );
}

// Decision P4 (12-storage): the type comes from the content, never from the client; PNG or JPEG
// only; re-encoded, which drops EXIF/GPS metadata and anything appended to the image, and scaled
// to fit 1024×1024.
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata());
  } catch {
    unsupported();
  }
  if (format !== 'png' && format !== 'jpeg') unsupported();
  const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      fit: 'inside',
      height: PHOTO_MAX_SIDE,
      width: PHOTO_MAX_SIDE,
      withoutEnlargement: true,
    });
  try {
    const body =
      format === 'png'
        ? await pipeline.png().toBuffer()
        : await pipeline.jpeg({ mozjpeg: true, quality: 85 }).toBuffer();
    return { body, mime: OUTPUT[format] };
  } catch {
    // Truncated or corrupt image data behind a valid header.
    unsupported();
  }
}
