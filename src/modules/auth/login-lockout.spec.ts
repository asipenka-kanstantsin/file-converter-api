import { ErrorCode } from '@/common/errors';
import type { AppConfig } from '@/config';

import { LoginLockout } from './login-lockout';

const config = {
  throttle: {
    loginBlockSeconds: 900,
    loginLimit: 3,
    loginWindowSeconds: 900,
    ttlSeconds: 60,
  },
} as AppConfig;

const key = LoginLockout.keyOf('10.0.0.1', 'jane@example.com');

function failTimes(lockout: LoginLockout, count: number): void {
  for (let i = 0; i < count; i++) lockout.begin(key).fail();
}

describe('LoginLockout', () => {
  it('counts failures spread wider than the throttler window, so a slow brute force locks', () => {
    // One failure every 70 s. Under a 60 s window each one aged out before the next arrived and
    // the pair was never blocked — which is the pace a password brute force runs at.
    jest.useFakeTimers();
    try {
      const lockout = new LoginLockout(config);
      for (let i = 0; i < 3; i++) {
        lockout.begin(key).fail();
        jest.advanceTimersByTime(70_000);
      }

      expect(() => lockout.begin(key)).toThrow(
        expect.objectContaining({ code: ErrorCode.RATE_LIMITED }) as Error,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows attempts below the limit', () => {
    const lockout = new LoginLockout(config);
    failTimes(lockout, 2);

    expect(() => lockout.begin(key).release()).not.toThrow();
  });

  it('blocks the pair for the block duration once the limit is reached', () => {
    const lockout = new LoginLockout(config);
    failTimes(lockout, 3);

    expect(() => lockout.begin(key)).toThrow(
      expect.objectContaining({ code: ErrorCode.RATE_LIMITED }) as Error,
    );
    try {
      lockout.begin(key);
    } catch (error: unknown) {
      const { retryAfter } = (error as { context: { retryAfter: number } })
        .context;
      expect(retryAfter).toBeGreaterThan(890);
    }
    expect(() =>
      lockout.begin(key, Date.now() + 900_001).release(),
    ).not.toThrow();
    expect(() =>
      lockout
        .begin(LoginLockout.keyOf('10.0.0.2', 'jane@example.com'))
        .release(),
    ).not.toThrow();
  });

  it('reserves a slot per attempt, so parallel attempts cannot exceed the limit', () => {
    const lockout = new LoginLockout(config);
    const inFlight = [
      lockout.begin(key),
      lockout.begin(key),
      lockout.begin(key),
    ];

    expect(() => lockout.begin(key)).toThrow(
      expect.objectContaining({ code: ErrorCode.RATE_LIMITED }) as Error,
    );
    for (const attempt of inFlight) attempt.fail();
    expect(() => lockout.begin(key, Date.now() + 1_000)).toThrow();
  });

  it('frees a released slot without counting a failure', () => {
    const lockout = new LoginLockout(config);
    for (let i = 0; i < 10; i++) lockout.begin(key).release();

    expect(() => lockout.begin(key).release()).not.toThrow();
  });

  it('settles an attempt only once', () => {
    const lockout = new LoginLockout(config);
    const attempt = lockout.begin(key);
    attempt.fail();
    attempt.fail();
    attempt.release();

    failTimes(lockout, 1);
    expect(() => lockout.begin(key).release()).not.toThrow();
  });

  it('forgets failures older than the window', () => {
    const lockout = new LoginLockout(config);
    failTimes(lockout, 2);

    expect(() =>
      lockout.begin(key, Date.now() + 61_000).release(),
    ).not.toThrow();
  });

  it('clears the count on success', () => {
    const lockout = new LoginLockout(config);
    failTimes(lockout, 2);
    lockout.begin(key).succeed();
    failTimes(lockout, 2);

    expect(() => lockout.begin(key).release()).not.toThrow();
  });

  it('prunes idle keys when it tracks too many, keeping blocked ones', () => {
    const lockout = new LoginLockout(config);
    failTimes(lockout, 3);
    for (let i = 0; i <= 10_000; i++) lockout.begin(`k${String(i)}`).fail();
    lockout.begin('trigger', Date.now() + 120_000).fail();

    expect(() => lockout.begin(key, Date.now() + 120_001)).toThrow();
  });

  it('never tracks more than the ceiling, evicting the oldest unblocked pair', () => {
    const lockout = new LoginLockout(config);
    const { entries } = lockout as unknown as { entries: Map<string, unknown> };
    failTimes(lockout, 3);
    for (let i = 0; i < 10_100; i++) lockout.begin(`k${String(i)}`).fail();

    expect(entries.size).toBe(10_000);
    expect(entries.has('k0')).toBe(false);
    expect(entries.has('k10099')).toBe(true);
    expect(() => lockout.begin(key)).toThrow(
      expect.objectContaining({ code: ErrorCode.RATE_LIMITED }) as Error,
    );
  });
});
