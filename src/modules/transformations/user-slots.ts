import { HttpStatus } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';

// How many conversions of one kind a single account may have running at once. The resources
// behind them are shared and small — two SVG child processes, a four-thread worker pool — so
// without a per-account ceiling one client can hold every slot of a resource and everyone else
// gets 503, at a request rate far below the `convert` limit (its 30/min are per IP, and a slow
// SVG holds its slot for the whole 30 s timeout). The image ceiling is below the number of SVG
// slots on purpose: a second account always finds one free.
export class UserSlots {
  private readonly held = new Map<string, number>();

  constructor(private readonly max: number) {}

  // Throws 429 when the account is already at its ceiling; otherwise returns the release.
  take(userId: string): () => void {
    const held = this.held.get(userId) ?? 0;
    if (held >= this.max) {
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfter: 1 },
      );
    }
    this.held.set(userId, held + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.held.get(userId) ?? 1;
      // The entry goes when the last one is released, so the map tracks only active accounts.
      if (current <= 1) this.held.delete(userId);
      else this.held.set(userId, current - 1);
    };
  }

  // Tests and diagnostics: how many an account holds right now.
  heldBy(userId: string): number {
    return this.held.get(userId) ?? 0;
  }
}
