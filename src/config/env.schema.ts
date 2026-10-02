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

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export const envSchema = z
  .object({
    APP_CORS_ORIGINS: commaList.pipe(z.array(z.url()).min(1)),
    APP_JSON_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/)
      .default('1mb'),
    APP_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    APP_TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.url(),
    LOG_LEVEL: z.enum(['debug', 'error', 'info', 'warn']).default('info'),
    LOG_PRETTY: booleanString.default(false),
    NODE_ENV: z.enum(['development', 'production', 'test']),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  })
  // Notion NFR: CORS only for trusted domains — in production that excludes plain http and
  // local origins.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const origin of env.APP_CORS_ORIGINS) {
      if (!origin.startsWith('https://') || LOCAL_ORIGIN.test(origin)) {
        ctx.addIssue({
          code: 'custom',
          message: 'production_origin_must_be_https',
          path: ['APP_CORS_ORIGINS'],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
