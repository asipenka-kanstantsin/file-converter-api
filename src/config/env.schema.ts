import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const positiveInt = z.coerce.number().int().positive();

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export const envSchema = z
  .object({
    APP_CORS_ORIGINS: commaList.pipe(z.array(z.url()).min(1)),
    APP_JSON_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/)
      .default('1mb'),
    APP_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    APP_PUBLIC_URL: z.url(),
    APP_TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    AUTH_COOKIE_SECURE: booleanString.default(true),
    AUTH_OTP_PEPPER: z.string().min(32),
    CONFIRMATION_MAX_ATTEMPTS: positiveInt.default(5),
    CONFIRMATION_RESEND_COOLDOWN_SECONDS: positiveInt.default(60),
    CONFIRMATION_TTL_SECONDS: positiveInt.default(600),
    DATABASE_URL: z.url(),
    JOBS_ENABLED: booleanString.default(true),
    LOG_LEVEL: z.enum(['debug', 'error', 'info', 'warn']).default('info'),
    LOG_PRETTY: booleanString.default(false),
    MAIL_FROM: z.string().min(3).max(200),
    NODE_ENV: z.enum(['development', 'production', 'test']),
    OUTBOX_POLL_INTERVAL_MS: positiveInt.default(1000),
    SMTP_HOST: z.string().min(1),
    SMTP_PASS: optionalSecret,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: optionalSecret,
    THROTTLE_CONFIRM_LIMIT: positiveInt.default(10),
    THROTTLE_LIMIT: positiveInt.default(100),
    THROTTLE_MAIL_LIMIT: positiveInt.default(3),
    THROTTLE_TTL_SECONDS: positiveInt.default(60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Notion NFR: CORS only for trusted domains — in production no plain http, no local origins.
    for (const origin of env.APP_CORS_ORIGINS) {
      if (!origin.startsWith('https://') || LOCAL_ORIGIN.test(origin)) {
        ctx.addIssue({
          code: 'custom',
          message: 'production_origin_must_be_https',
          path: ['APP_CORS_ORIGINS'],
        });
      }
    }
    if (!env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        message: 'production_cookies_must_be_secure',
        path: ['AUTH_COOKIE_SECURE'],
      });
    }
    if (!env.SMTP_USER || !env.SMTP_PASS) {
      ctx.addIssue({
        code: 'custom',
        message: 'production_smtp_requires_auth',
        path: ['SMTP_USER'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
