import { Readable } from 'node:stream';

import type { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { streamFile } from '@/common/http/streaming';

import type { ConversionResult } from './transformations.service';

export const RESULT_SAVED_HEADER = 'X-Result-Saved';

// What both convert endpoints answer with. When the caller asked for `save`, the header says
// whether the result was taken for saving: a bare 200 would otherwise read as "it is saved", and
// the download would only turn out missing later (REL, decision F13).
export function convertedFile(
  result: ConversionResult,
  response: Response,
): StreamableFile {
  if (result.saved !== undefined) {
    response.setHeader(RESULT_SAVED_HEADER, String(result.saved));
  }
  return streamFile(Readable.from([result.body]), {
    disposition: `attachment; filename="${result.filename}"`,
    length: result.body.length,
    type: result.mime,
  });
}
