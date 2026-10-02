import { Injectable } from '@nestjs/common';

import type { OutboxHandler } from './outbox.types';

@Injectable()
export class OutboxRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  get(type: string): OutboxHandler | undefined {
    return this.handlers.get(type);
  }

  register(type: string, handler: OutboxHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Outbox handler for ${type} is already registered`);
    }
    this.handlers.set(type, handler);
  }
}
