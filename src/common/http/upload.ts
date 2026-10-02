import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  mixin,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import type { Observable } from 'rxjs';

import { AppException, ErrorCode } from '@/common/errors';

// One multipart file in memory, at most `maxBytes` (12-storage → Upload validation). The size is
// enforced while streaming, so an oversized upload is cut off, not buffered. Errors become the
// API's own codes instead of Nest's generic ones.
export function SingleFileUpload(
  field: string,
  maxBytes: number,
): Type<NestInterceptor> {
  const upload = multer({
    limits: { fields: 10, files: 1, fileSize: maxBytes, parts: 12 },
    storage: multer.memoryStorage(),
  }).single(field);

  class SingleFileUploadInterceptor implements NestInterceptor {
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      const http = context.switchToHttp();
      await new Promise<void>((resolve, reject) => {
        upload(
          http.getRequest<Request>(),
          http.getResponse<Response>(),
          (error: unknown) => {
            if (error === undefined || error === null) {
              resolve();
              return;
            }
            reject(toAppException(error, maxBytes));
          },
        );
      });
      return next.handle();
    }
  }
  return mixin(SingleFileUploadInterceptor);
}

function toAppException(error: unknown, maxBytes: number): AppException {
  if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return new AppException(
      ErrorCode.FILE_TOO_LARGE,
      HttpStatus.PAYLOAD_TOO_LARGE,
      { maxBytes },
    );
  }
  // Too many files or parts, a foreign field, a broken multipart body.
  return new AppException(ErrorCode.MALFORMED_REQUEST, HttpStatus.BAD_REQUEST);
}

// The uploaded file, or 400 when the request carried none.
export function requireFile(
  file: Express.Multer.File | undefined,
): Express.Multer.File {
  if (!file) {
    throw new AppException(ErrorCode.MALFORMED_REQUEST, HttpStatus.BAD_REQUEST);
  }
  return file;
}
