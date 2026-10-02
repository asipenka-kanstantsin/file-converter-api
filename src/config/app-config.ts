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
    accessSecret: string;
    accessTtlSeconds: number;
    cookieSecure: boolean;
    otpPepper: string;
    refreshSecret: string;
    refreshTtlSeconds: number;
  };
  readonly confirmation!: {
    maxAttempts: number;
    resendCooldownSeconds: number;
    ttlSeconds: number;
  };
  readonly conversion!: { timeoutMs: number; workers: number | undefined };
  readonly db!: { url: string };
  readonly jobs!: { enabled: boolean; outboxPollIntervalMs: number };
  readonly log!: { level: Env['LOG_LEVEL']; pretty: boolean };
  readonly storage!: {
    driver: Env['STORAGE_DRIVER'];
    localDir: string;
    s3: {
      accessKeyId?: string;
      bucket?: string;
      endpoint?: string;
      forcePathStyle: boolean;
      region: string;
      secretAccessKey?: string;
    };
  };
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
    convertLimit: number;
    limit: number;
    loginBlockSeconds: number;
    loginLimit: number;
    mailLimit: number;
    profileLimit: number;
    ttlSeconds: number;
    uploadLimit: number;
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
      accessSecret: env.AUTH_JWT_ACCESS_SECRET,
      accessTtlSeconds: env.AUTH_ACCESS_TTL_SECONDS,
      cookieSecure: env.AUTH_COOKIE_SECURE,
      otpPepper: env.AUTH_OTP_PEPPER,
      refreshSecret: env.AUTH_JWT_REFRESH_SECRET,
      refreshTtlSeconds: env.AUTH_REFRESH_TTL_SECONDS,
    }),
    confirmation: Object.freeze({
      maxAttempts: env.CONFIRMATION_MAX_ATTEMPTS,
      resendCooldownSeconds: env.CONFIRMATION_RESEND_COOLDOWN_SECONDS,
      ttlSeconds: env.CONFIRMATION_TTL_SECONDS,
    }),
    conversion: Object.freeze({
      timeoutMs: env.CONVERSION_TIMEOUT_MS,
      workers: env.CONVERSION_WORKERS,
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
    storage: Object.freeze({
      driver: env.STORAGE_DRIVER,
      localDir: env.STORAGE_LOCAL_DIR,
      s3: Object.freeze({
        accessKeyId: env.S3_ACCESS_KEY_ID,
        bucket: env.S3_BUCKET,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        region: env.S3_REGION,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      }),
    }),
    throttle: Object.freeze({
      confirmLimit: env.THROTTLE_CONFIRM_LIMIT,
      convertLimit: env.THROTTLE_CONVERT_LIMIT,
      limit: env.THROTTLE_LIMIT,
      loginBlockSeconds: env.THROTTLE_LOGIN_BLOCK_SECONDS,
      loginLimit: env.THROTTLE_LOGIN_LIMIT,
      mailLimit: env.THROTTLE_MAIL_LIMIT,
      profileLimit: env.THROTTLE_PROFILE_LIMIT,
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
      uploadLimit: env.THROTTLE_UPLOAD_LIMIT,
    }),
  });
}
