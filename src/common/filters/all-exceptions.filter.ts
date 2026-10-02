import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

import {
  AppException,
  ERROR_MESSAGES,
  ErrorCode,
  type ErrorContext,
  type ErrorEnvelope,
  EXCEPTION_MAPPERS,
  type ExceptionMapper,
  type MappedException,
  validationMessage,
} from '@/common/errors';

const HTTP_STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.MALFORMED_REQUEST,
  [HttpStatus.NOT_FOUND]: ErrorCode.ROUTE_NOT_FOUND,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
};

const WARN_STATUSES = new Set<number>([
  HttpStatus.FORBIDDEN,
  HttpStatus.LOCKED,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.UNAUTHORIZED,
]);

// The `type` values body-parser / raw-body attach to their http-errors objects.
const BODY_PARSER_ERROR_TYPES = new Set([
  'charset.unsupported',
  'encoding.unsupported',
  'entity.parse.failed',
  'entity.too.large',
  'parameters.too.many',
  'request.aborted',
  'request.size.invalid',
]);

interface BodyParserError {
  status: number;
  type: string;
}

// body-parser rejects requests with http-errors objects (`type: 'entity.too.large'`, …), which
// are neither HttpException nor errors Nest maps itself.
function isBodyParserError(exception: unknown): exception is BodyParserError {
  if (typeof exception !== 'object' || exception === null) return false;
  if (!('type' in exception) || !('status' in exception)) return false;
  const { status, type } = exception;
  return (
    typeof type === 'string' &&
    BODY_PARSER_ERROR_TYPES.has(type) &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  );
}

function bodyParserCode(status: number): ErrorCode {
  if (status === 413) return ErrorCode.PAYLOAD_TOO_LARGE;
  if (status === 415) return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
  return ErrorCode.MALFORMED_REQUEST;
}

function validationContext(error: ZodError): ErrorContext {
  return {
    fields: error.issues.map((issue) => {
      // Custom refinements carry a machine code as their message (06-validation).
      const code = issue.code === 'custom' ? issue.message : issue.code;
      return {
        code,
        detail: validationMessage(code),
        path: issue.path.map(String).join('.'),
      };
    }),
  };
}

// Named throttlers set `Retry-After-<name>`; the default one sets `Retry-After`.
function retryAfterSeconds(response: Response): number | undefined {
  for (const name of response.getHeaderNames()) {
    if (!name.toLowerCase().startsWith('retry-after')) continue;
    const header = response.getHeader(name);
    const seconds = Number(Array.isArray(header) ? header[0] : header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return undefined;
}

function routePath(request: Request): string | undefined {
  const route: unknown = request.route;
  if (typeof route !== 'object' || route === null || !('path' in route)) {
    return undefined;
  }
  return typeof route.path === 'string' ? route.path : undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    @Inject(EXCEPTION_MAPPERS)
    private readonly mappers: readonly ExceptionMapper[],
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    const resolved = this.resolve(exception, response);

    this.log(exception, resolved, request);
    if (response.headersSent) return;

    const retryAfter = resolved.context?.retryAfter;
    if (
      resolved.code === ErrorCode.RATE_LIMITED &&
      typeof retryAfter === 'number'
    ) {
      response.setHeader('Retry-After', String(retryAfter));
    }

    const body: ErrorEnvelope = {
      code: resolved.code,
      detail: ERROR_MESSAGES[resolved.code],
      ...(resolved.context ? { context: resolved.context } : {}),
    };
    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown, response: Response): MappedException {
    if (exception instanceof AppException) {
      return {
        code: exception.code,
        context: exception.context,
        status: exception.status,
      };
    }
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      return {
        code: ErrorCode.VALIDATION_FAILED,
        status: HttpStatus.BAD_REQUEST,
        ...(zodError instanceof ZodError
          ? { context: validationContext(zodError) }
          : {}),
      };
    }
    if (exception instanceof ThrottlerException) {
      const retryAfter = retryAfterSeconds(response);
      return {
        code: ErrorCode.RATE_LIMITED,
        status: HttpStatus.TOO_MANY_REQUESTS,
        ...(retryAfter === undefined ? {} : { context: { retryAfter } }),
      };
    }
    for (const mapper of this.mappers) {
      const mapped = mapper(exception);
      if (mapped) return mapped;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_STATUS_CODES[status];
      if (code) return { code, status };
      // A client error Nest or a library raised without an AppException: keep its status
      // rather than inventing a 500.
      if (status >= 400 && status < 500) {
        return { code: ErrorCode.REQUEST_REJECTED, status };
      }
    }
    if (isBodyParserError(exception)) {
      return {
        code: bodyParserCode(exception.status),
        status: exception.status,
      };
    }
    return {
      code: ErrorCode.INTERNAL_ERROR,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  private log(
    exception: unknown,
    resolved: MappedException,
    request: Request & { id?: string },
  ): void {
    const fields = {
      code: resolved.code,
      method: request.method,
      requestId: request.id,
      route: routePath(request),
      status: resolved.status,
    };
    if (resolved.status >= 500) {
      this.logger.error({ ...fields, err: exception }, 'request failed');
    } else if (WARN_STATUSES.has(resolved.status)) {
      this.logger.warn(fields, 'request rejected');
    } else {
      // Rejected attempts are audit events too (e.g. an invalid registration, Notion 1.5).
      this.logger.log(fields, 'request rejected');
    }
  }
}
