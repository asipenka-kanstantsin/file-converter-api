import { Inject, Injectable, Logger } from '@nestjs/common';
import { z, type ZodType } from 'zod';

import { AppConfig } from '@/config';
import { OutboxService, PermanentJobError } from '@/infrastructure/outbox';

import {
  MAIL_TEMPLATES,
  type MailTemplate,
  type MailVars,
  type RenderedMail,
} from './mail-templates';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport';

export const MAIL_SEND = 'mail.send';

const mailPayloadSchema = z.object({
  template: z.enum(
    Object.keys(MAIL_TEMPLATES) as [MailTemplate, ...MailTemplate[]],
  ),
  to: z.email(),
  vars: z.record(z.string(), z.unknown()),
});

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly outbox: OutboxService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  // Writes the mail into the caller's transaction; it is sent only after commit (11-mail).
  async enqueue<T extends MailTemplate>(
    template: T,
    to: string,
    vars: MailVars<T>,
    idempotencyKey: string,
  ): Promise<void> {
    const parsed = MAIL_TEMPLATES[template].vars.parse(vars);
    await this.outbox.enqueue({
      idempotencyKey,
      payload: { template, to, vars: parsed },
      type: MAIL_SEND,
    });
  }

  async deliver(payload: unknown): Promise<void> {
    const parsed = mailPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid mail payload');
    const { template, to } = parsed.data;
    // Each template's render takes exactly what its own vars schema produced.
    const definition = MAIL_TEMPLATES[template] as unknown as {
      render(vars: unknown): RenderedMail;
      vars: ZodType;
    };
    const vars = definition.vars.safeParse(parsed.data.vars);
    if (!vars.success)
      throw new PermanentJobError(`invalid vars for ${template}`);

    const rendered = definition.render(vars.data);
    const { messageId } = await this.transport.send({
      ...rendered,
      from: this.config.mail.from,
      headers: { 'X-Mail-Template': template },
      to,
    });
    this.logger.log({ messageId, template, to: maskEmail(to) }, 'mail sent');
  }
}
