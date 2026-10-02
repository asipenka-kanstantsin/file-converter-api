import type { IncomingMessage } from 'node:http';

import { type AppConfig, parseAppConfig } from '@/config';

import {
  buildLoggerOptions,
  REDACTED_PATHS,
  requestUser,
  serializeRequest,
} from './logger.options';

function config(pretty: boolean): AppConfig {
  return parseAppConfig({
    APP_CORS_ORIGINS: 'http://localhost:3000',
    APP_PUBLIC_URL: 'http://localhost:3001',
    AUTH_JWT_ACCESS_SECRET: 'a'.repeat(32),
    AUTH_JWT_REFRESH_SECRET: 'r'.repeat(32),
    AUTH_OTP_PEPPER: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
    LOG_LEVEL: 'warn',
    LOG_PRETTY: String(pretty),
    MAIL_FROM: 'test@example.com',
    NODE_ENV: 'test',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
  });
}

type PinoOptions = {
  autoLogging: { ignore: (request: IncomingMessage) => boolean };
  genReqId: (request: IncomingMessage) => string;
  level: string;
  redact: { paths: string[] };
  transport?: unknown;
};

describe('buildLoggerOptions', () => {
  const options = buildLoggerOptions(config(false)).pinoHttp as PinoOptions;

  it('redacts credentials, tokens, codes and e-mails', () => {
    expect(options.redact.paths).toEqual(REDACTED_PATHS);
    expect(REDACTED_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.cookie',
        '*.password',
        '*.otp',
        '*.email',
      ]),
    );
  });

  it('skips health checks in the access log', () => {
    const ignore = (url: string): boolean =>
      options.autoLogging.ignore({ url } as IncomingMessage);

    expect(ignore('/health')).toBe(true);
    expect(ignore('/health/live?x=1')).toBe(true);
    expect(ignore('/api/openapi.json')).toBe(false);
  });

  it('reuses the request id set by the middleware', () => {
    expect(
      options.genReqId({ id: 'req-1' } as IncomingMessage & { id: string }),
    ).toBe('req-1');
    expect(options.genReqId({} as IncomingMessage)).toBe('unknown');
    expect(options.level).toBe('warn');
  });

  it('pretty-prints only when configured', () => {
    expect(options.transport).toBeUndefined();
    expect(
      (buildLoggerOptions(config(true)).pinoHttp as PinoOptions).transport,
    ).toBeDefined();
  });

  it('logs the request line without query string or headers', () => {
    const serialized = serializeRequest({
      headers: { cookie: 'access_token=secret' },
      id: 'req-1',
      method: 'GET',
      url: '/api/auth/confirm?token=SECRET-TOKEN',
    } as Parameters<typeof serializeRequest>[0]);

    expect(serialized).toEqual({
      id: 'req-1',
      method: 'GET',
      path: '/api/auth/confirm',
    });
    expect(JSON.stringify(serialized)).not.toContain('SECRET');
    expect(serializeRequest({}).path).toBe('');
  });

  it('names the signed-in user on the request line, once the guard has run', () => {
    expect(requestUser({} as IncomingMessage)).toEqual({});
    expect(
      requestUser({ user: { id: 'u1' } } as unknown as IncomingMessage),
    ).toEqual({ userId: 'u1' });
  });
});
