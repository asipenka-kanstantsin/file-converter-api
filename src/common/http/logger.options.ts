import type { IncomingMessage } from 'node:http';

import type { Params } from 'nestjs-pino';

import type { AuthenticatedRequest } from '@/common/decorators';
import type { AppConfig } from '@/config';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  "req.headers['x-csrf-token']",
  "res.headers['set-cookie']",
  '*.password',
  '*.newPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.otp',
  '*.otpCode',
  '*.secret',
  '*.email',
];

const UNLOGGED_PATHS = new Set(['/health', '/health/live', '/health/ready']);

function pathOf(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

// The request line only: no headers, no query string. Query strings carry one-time secrets
// (the magic-link token in GET /api/auth/confirm?token=…), and bodies are never logged.
export function serializeRequest(
  request: LoggedRequest,
): Record<string, unknown> {
  return { id: request.id, method: request.method, path: pathOf(request.url) };
}

// pino-http evaluates this again when the response finishes, after the access guard ran: the
// request line then names who made it (Notion "Авторизация" 1.5).
export function requestUser(request: IncomingMessage): Record<string, string> {
  const { user } = request as Partial<AuthenticatedRequest>;
  return user ? { userId: user.id } : {};
}

export function buildLoggerOptions(config: AppConfig): Params {
  return {
    pinoHttp: {
      autoLogging: {
        ignore: (request: IncomingMessage) =>
          UNLOGGED_PATHS.has(pathOf(request.url)),
      },
      customProps: requestUser,
      genReqId: (request: IncomingMessage & { id?: unknown }) =>
        typeof request.id === 'string' ? request.id : 'unknown',
      level: config.log.level,
      redact: { censor: '[redacted]', paths: REDACTED_PATHS },
      serializers: { req: serializeRequest },
      ...(config.log.pretty
        ? {
            transport: { options: { singleLine: true }, target: 'pino-pretty' },
          }
        : {}),
    },
  };
}
