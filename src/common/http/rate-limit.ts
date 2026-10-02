import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

import type { AppConfig } from '@/config';

// Stricter named limits on top of the global one (09-auth → Rate limits). A route opts in with
// @RateLimit('mail'); every other route skips these throttlers.
export type RateLimitGroup = 'confirm' | 'mail' | 'profile';

export const RATE_LIMIT_KEY = 'rateLimitGroup';

export const RateLimit = (group: RateLimitGroup): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, group);

function groupOf(context: ExecutionContext): unknown {
  return Reflect.getMetadata(RATE_LIMIT_KEY, context.getHandler());
}

export function buildThrottlers(config: AppConfig): ThrottlerOptions[] {
  const ttl = config.throttle.ttlSeconds * 1000;
  const group = (name: RateLimitGroup, limit: number): ThrottlerOptions => ({
    limit,
    name,
    skipIf: (context) => groupOf(context) !== name,
    ttl,
  });
  return [
    { limit: config.throttle.limit, name: 'default', ttl },
    group('mail', config.throttle.mailLimit),
    group('confirm', config.throttle.confirmLimit),
    group('profile', config.throttle.profileLimit),
  ];
}
