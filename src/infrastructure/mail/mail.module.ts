import { Module, type OnModuleInit } from '@nestjs/common';

import { AppConfig } from '@/config';
import { OutboxModule, OutboxRegistry } from '@/infrastructure/outbox';

import { MAIL_TRANSPORT } from './mail-transport';
import { MAIL_SEND, MailService } from './mail.service';
import { SmtpMailTransport } from './smtp.transport';

@Module({
  exports: [MailService],
  imports: [OutboxModule],
  providers: [
    MailService,
    {
      inject: [AppConfig],
      provide: MAIL_TRANSPORT,
      useFactory: (config: AppConfig) => new SmtpMailTransport(config),
    },
  ],
})
export class MailModule implements OnModuleInit {
  constructor(
    private readonly mail: MailService,
    private readonly registry: OutboxRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(MAIL_SEND, (payload) => this.mail.deliver(payload));
  }
}
