import { Injectable } from '@nestjs/common';

import type { User } from '@/modules/users';

import type { ChallengePurpose } from './challenges.types';

// What another module does when a challenge of its purpose is confirmed (account deletion lives
// in accounts, which depends on auth, not the other way round). `lock` runs before the challenge
// row is consumed, so every path takes its locks in the same order (P8).
export interface ConfirmationHandler {
  complete(userId: string): Promise<User>;
  // After the transaction committed (audit entries must not describe a rolled-back change).
  completed?(userId: string): void;
  lock(userId: string): Promise<null | User>;
}

@Injectable()
export class ConfirmationHandlers {
  private readonly handlers = new Map<ChallengePurpose, ConfirmationHandler>();

  get(purpose: ChallengePurpose): ConfirmationHandler | undefined {
    return this.handlers.get(purpose);
  }

  register(purpose: ChallengePurpose, handler: ConfirmationHandler): void {
    if (this.handlers.has(purpose)) {
      throw new Error(
        `A confirmation handler for ${purpose} is already registered`,
      );
    }
    this.handlers.set(purpose, handler);
  }
}
