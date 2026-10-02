import type { Readable } from 'node:stream';

import { HttpStatus, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { ERROR_MESSAGES, ErrorCode } from '@/common/errors';

// A stored file streamed to the client. Nest's default answers a stream error with 400 and the
// raw error message (a server path for a local file); here it is the 500 envelope while nothing
// was sent yet, and an aborted connection afterwards, so a client never takes a truncated body
// for a complete one.
export function streamFile(
  body: Readable,
  options: { disposition?: string; length?: number; type: string },
): StreamableFile {
  return new StreamableFile(body, options).setErrorHandler(
    (_error, handlerResponse) => {
      const response = handlerResponse as unknown as Response;
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.removeHeader('Content-Length');
      response.removeHeader('Content-Disposition');
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .type('application/json')
        .send(
          JSON.stringify({
            code: ErrorCode.STORAGE_UNAVAILABLE,
            detail: ERROR_MESSAGES[ErrorCode.STORAGE_UNAVAILABLE],
          }),
        );
    },
  );
}
