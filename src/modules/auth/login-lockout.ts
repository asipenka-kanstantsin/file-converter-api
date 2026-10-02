import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';

interface Entry {
  blockedUntil: number;
  failures: number[];
  inFlight: number;
}

export interface LoginAttempt {
  // The password was wrong (or the e-mail unknown): counts towards the lockout.
  fail(): void;
  // Ended without a verdict on the password (e.g. an unexpected error): frees the slot only.
  release(): void;
  // The password was right: clears the count.
  succeed(): void;
}

const MAX_TRACKED_KEYS = 10_000;

// Notion "Аутентификация" 1.6 (decision A15): only **failed** sign-ins count. Five failures for
// one client IP + e-mail within the window block that pair for 15 minutes; a successful sign-in
// clears the count. An attempt reserves a slot before the password is checked, so parallel
// requests cannot all pass the check before the first failure is recorded. Single-instance memory.
@Injectable()
export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly config: AppConfig) {}

  static keyOf(ip: string, email: string): string {
    return `${ip}|${email}`;
  }

  begin(key: string, now = Date.now()): LoginAttempt {
    const { loginLimit, ttlSeconds } = this.config.throttle;
    const entry = this.entries.get(key) ?? {
      blockedUntil: 0,
      failures: [],
      inFlight: 0,
    };
    if (entry.blockedUntil > now) this.reject(entry.blockedUntil - now);
    const windowStart = now - ttlSeconds * 1000;
    entry.failures = entry.failures.filter((at) => at > windowStart);
    if (entry.failures.length + entry.inFlight >= loginLimit) {
      const oldest = entry.failures[0];
      this.reject(
        oldest === undefined ? 1000 : oldest + ttlSeconds * 1000 - now,
      );
    }
    entry.inFlight += 1;
    this.entries.set(key, entry);
    if (this.entries.size > MAX_TRACKED_KEYS) this.prune(now);

    let settled = false;
    const settle = (outcome: (current: Entry) => void): void => {
      if (settled) return;
      settled = true;
      const current = this.entries.get(key) ?? entry;
      current.inFlight = Math.max(0, current.inFlight - 1);
      outcome(current);
      if (
        current.inFlight === 0 &&
        current.failures.length === 0 &&
        current.blockedUntil <= Date.now()
      ) {
        this.entries.delete(key);
      } else {
        this.entries.set(key, current);
      }
    };
    return {
      fail: () => {
        settle((current) => {
          this.recordFailure(current, Date.now());
        });
      },
      release: () => {
        settle(() => undefined);
      },
      succeed: () => {
        settle((current) => {
          current.failures = [];
        });
      },
    };
  }

  private prune(now: number): void {
    const windowStart = now - this.config.throttle.ttlSeconds * 1000;
    for (const [key, entry] of this.entries) {
      const active =
        entry.inFlight > 0 ||
        entry.blockedUntil > now ||
        entry.failures.some((at) => at > windowStart);
      if (!active) this.entries.delete(key);
    }
  }

  private recordFailure(entry: Entry, now: number): void {
    const { loginBlockSeconds, loginLimit, ttlSeconds } = this.config.throttle;
    const windowStart = now - ttlSeconds * 1000;
    entry.failures = [...entry.failures.filter((at) => at > windowStart), now];
    if (entry.failures.length >= loginLimit) {
      entry.blockedUntil = now + loginBlockSeconds * 1000;
      entry.failures = [];
    }
  }

  private reject(remainingMs: number): never {
    throw new AppException(
      ErrorCode.RATE_LIMITED,
      HttpStatus.TOO_MANY_REQUESTS,
      {
        retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)),
      },
    );
  }
}
