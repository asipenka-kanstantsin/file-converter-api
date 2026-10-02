import { HttpStatus } from '@nestjs/common';

import { ErrorCode, type ExceptionMapper } from '@/common/errors';

import { StorageUnavailableError } from './storage.port';

// Notion "Сохранение результатов ...": storage errors answer 500.
export const mapStorageException: ExceptionMapper = (exception) =>
  exception instanceof StorageUnavailableError
    ? {
        code: ErrorCode.STORAGE_UNAVAILABLE,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      }
    : undefined;
