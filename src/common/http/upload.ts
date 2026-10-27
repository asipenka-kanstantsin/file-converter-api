import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  mixin,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import type { Observable } from 'rxjs';

import { AppException, ErrorCode } from '@/common/errors';

// Resolves the limit per request (a runtime setting, F1); gets the module's providers.
export type UploadLimit = number | ((moduleRef: ModuleRef) => Promise<number>);

// One multipart file in memory, at most the limit (12-storage → Upload validation). The size is
// enforced while streaming, so an oversized upload is cut off, not buffered. Errors become the
// API's own codes instead of Nest's generic ones.
export function SingleFileUpload(
  field: string,
  limit: UploadLimit,
): Type<NestInterceptor> {
  @Injectable()
  class SingleFileUploadInterceptor implements NestInterceptor {
    constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      const maxBytes =
        typeof limit === 'number' ? limit : await limit(this.moduleRef);
      const upload = multer({
        // The text fields carry a target format, a flag and a small options object; without a
        // size of their own multer would buffer multer's 1 MB default for each of the 10.
        limits: {
          fieldNameSize: 64,
          fields: 10,
          fieldSize: 2048,
          files: 1,
          fileSize: maxBytes,
          parts: 12,
        },
        storage: multer.memoryStorage(),
      }).single(field);
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
