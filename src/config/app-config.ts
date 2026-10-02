import type { Env } from './env.schema';

export class AppConfig {
  readonly app!: {
    corsOrigins: readonly string[];
    jsonBodyLimit: string;
    port: number;
    publicUrl: string;
    trustProxy: number;
  };
  readonly auth!: {
    cookieSecure: boolean;
    otpPepper: string;
  };
  readonly confirmation!: {
    maxAttempts: number;
    resendCooldownSeconds: number;
    ttlSeconds: number;
  };
  readonly db!: { url: string };
  readonly jobs!: { enabled: boolean; outboxPollIntervalMs: number };
  readonly log!: { level: Env['LOG_LEVEL']; pretty: boolean };
  readonly mail!: {
    from: string;
    smtp: {
      host: string;
      pass?: string;
      port: number;
      secure: boolean;
      user?: string;
    };
  };
  readonly throttle!: {
    confirmLimit: number;
    limit: number;
    mailLimit: number;
    ttlSeconds: number;
  };
}

export function buildAppConfig(env: Env): AppConfig {
  return Object.freeze({
    app: Object.freeze({
      corsOrigins: Object.freeze([...env.APP_CORS_ORIGINS]),
      jsonBodyLimit: env.APP_JSON_BODY_LIMIT,
      port: env.APP_PORT,
      publicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ''),
      trustProxy: env.APP_TRUST_PROXY,
    }),
    auth: Object.freeze({
      cookieSecure: env.AUTH_COOKIE_SECURE,
      otpPepper: env.AUTH_OTP_PEPPER,
    }),
    confirmation: Object.freeze({
      maxAttempts: env.CONFIRMATION_MAX_ATTEMPTS,
      resendCooldownSeconds: env.CONFIRMATION_RESEND_COOLDOWN_SECONDS,
      ttlSeconds: env.CONFIRMATION_TTL_SECONDS,
    }),
    db: Object.freeze({ url: env.DATABASE_URL }),
    jobs: Object.freeze({
      enabled: env.JOBS_ENABLED,
      outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    }),
    log: Object.freeze({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY }),
    mail: Object.freeze({
      from: env.MAIL_FROM,
      smtp: Object.freeze({
        host: env.SMTP_HOST,
        pass: env.SMTP_PASS,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
      }),
    }),
    throttle: Object.freeze({
      confirmLimit: env.THROTTLE_CONFIRM_LIMIT,
      limit: env.THROTTLE_LIMIT,
      mailLimit: env.THROTTLE_MAIL_LIMIT,
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
    }),
  });
}
