import { Module } from '@nestjs/common';

import { OutboxDispatcher } from './outbox.dispatcher';
import { OutboxRegistry } from './outbox.registry';
import { OutboxService } from './outbox.service';

@Module({
  exports: [OutboxDispatcher, OutboxRegistry, OutboxService],
  providers: [OutboxDispatcher, OutboxRegistry, OutboxService],
})
export class OutboxModule {}
