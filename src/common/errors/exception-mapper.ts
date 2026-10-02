import type { ErrorContext } from './app-exception';
import type { ErrorCode } from './error-code';

export interface MappedException {
  code: ErrorCode;
  context?: ErrorContext;
  status: number;
}

// Lets infrastructure (ORM, SDKs) teach the global filter about its own error types without
// common/ importing infrastructure/. Mappers are tried in order; undefined = not mine.
export type ExceptionMapper = (
  exception: unknown,
) => MappedException | undefined;

export const EXCEPTION_MAPPERS = Symbol('EXCEPTION_MAPPERS');
