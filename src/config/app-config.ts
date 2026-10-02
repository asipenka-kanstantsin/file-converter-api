import type { Env } from './env.schema';

export class AppConfig {
  readonly app!: {
    corsOrigins: readonly string[];
    jsonBodyLimit: string;
    port: number;
    trustProxy: number;
  };
  readonly db!: { url: string };
  readonly log!: { level: Env['LOG_LEVEL']; pretty: boolean };
  readonly throttle!: { limit: number; ttlSeconds: number };
}

export function buildAppConfig(env: Env): AppConfig {
  return Object.freeze({
    app: Object.freeze({
      corsOrigins: Object.freeze([...env.APP_CORS_ORIGINS]),
      jsonBodyLimit: env.APP_JSON_BODY_LIMIT,
      port: env.APP_PORT,
      trustProxy: env.APP_TRUST_PROXY,
    }),
    db: Object.freeze({ url: env.DATABASE_URL }),
    log: Object.freeze({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY }),
    throttle: Object.freeze({
      limit: env.THROTTLE_LIMIT,
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
    }),
  });
}
