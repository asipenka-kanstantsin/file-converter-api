import { createTransport, type Transporter } from 'nodemailer';

import type { AppConfig } from '@/config';

import type { MailTransport, OutgoingMail } from './mail-transport';

// SMTP is the only provider integration: Mailpit in dev, turboSMTP (or any relay) in prod is a
// config change (11-mail).
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(config: AppConfig) {
    const { smtp } = config.mail;
    this.transporter = createTransport({
      // Well below the outbox lease (120 s), so a hung server cannot outlive the claim.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      socketTimeout: 30_000,
      ...(smtp.user && smtp.pass
        ? { auth: { pass: smtp.pass, user: smtp.user } }
        : {}),
    });
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: mail.from,
      headers: { ...mail.headers },
      html: mail.html,
      subject: mail.subject,
      text: mail.text,
      to: mail.to,
    });
    return { messageId: info.messageId };
  }
}
