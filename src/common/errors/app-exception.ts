import { type HttpStatus } from '@nestjs/common';

import { type ErrorCode } from './error-code';

export type ErrorContext = Readonly<Record<string, unknown>>;

export interface ErrorEnvelope {
  code: ErrorCode;
  context?: ErrorContext;
  detail: string;
}

export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    readonly context?: ErrorContext,
  ) {
    super(code);
    this.name = 'AppException';
  }
}
