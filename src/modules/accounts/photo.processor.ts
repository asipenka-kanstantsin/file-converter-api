import { HttpStatus } from '@nestjs/common';
import sharp from 'sharp';

import { AppException, ErrorCode } from '@/common/errors';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1024;
// Decompression-bomb guard: a 5 MB PNG can still claim a huge canvas.
const MAX_INPUT_PIXELS = 40_000_000;
// libvips gives up after this, so one photo cannot hold a libuv thread (which sign-ins share).
const PHOTO_TIMEOUT_SECONDS = 10;

const OUTPUT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
} as const;

// libvips must not be handed anything the endpoint does not accept: without this, every format
// sharp can open (TIFF, GIF, HEIF, PDF…) reached the decoder before the PNG/JPEG check rejected
// it, so a bomb in one of those formats was decoded for nothing (P4, 12-storage).
function formatOf(input: Buffer): 'jpeg' | 'png' | undefined {
  if (
    input
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    return 'jpeg';
  }
  return undefined;
}

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
  const format = formatOf(input);
  if (!format) unsupported();
  const pipeline = sharp(input, {
    // A truncated or corrupt image is refused rather than decoded as far as it goes, as in the
    // conversion endpoints.
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .timeout({ seconds: PHOTO_TIMEOUT_SECONDS })
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
