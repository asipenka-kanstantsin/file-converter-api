import type { IncomingMessage } from 'node:http';

import type { Params } from 'nestjs-pino';

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

export function buildLoggerOptions(config: AppConfig): Params {
  return {
    pinoHttp: {
      autoLogging: {
        ignore: (request: IncomingMessage) =>
          UNLOGGED_PATHS.has((request.url ?? '').split('?')[0] ?? ''),
      },
      genReqId: (request: IncomingMessage & { id?: unknown }) =>
        typeof request.id === 'string' ? request.id : 'unknown',
      level: config.log.level,
      redact: { censor: '[redacted]', paths: REDACTED_PATHS },
      ...(config.log.pretty
        ? {
            transport: { options: { singleLine: true }, target: 'pino-pretty' },
          }
        : {}),
    },
  };
}
