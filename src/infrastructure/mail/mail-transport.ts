export interface OutgoingMail {
  from: string;
  headers: Readonly<Record<string, string>>;
  html: string;
  subject: string;
  text: string;
  to: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<{ messageId: string }>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
