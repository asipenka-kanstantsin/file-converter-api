import { z } from 'zod';

import type { SentMail } from './mail-sink';

const mailboxSchema = z.array(
  z.object({
    html: z.string(),
    id: z.string(),
    receivedAt: z.string(),
    subject: z.string(),
    text: z.string(),
    to: z.array(z.string()),
  }),
);

export type { SentMail };

function readUrl(): string {
  const url = process.env.MAIL_SINK_URL;
  if (!url) throw new Error('MAIL_SINK_URL is unset — globalSetup did not run');
  return url;
}

export async function clearMailbox(): Promise<void> {
  await fetch(readUrl(), { method: 'DELETE' });
}

// Newest first; the sink returns the mailbox in arrival order, which breaks ties within a
// millisecond.
export async function messagesTo(address: string): Promise<SentMail[]> {
  const response = await fetch(readUrl());
  const mailbox = mailboxSchema.parse(await response.json());
  const wanted = address.toLowerCase();
  // The sink keeps a recipient as it arrived; e-mail domains are case-insensitive.
  return mailbox
    .filter((mail) => mail.to.some((to) => to.toLowerCase() === wanted))
    .reverse();
}

// Polls with a deadline instead of sleeping (18-testing).
export async function waitForMessageTo(
  address: string,
  count = 1,
  timeoutMs = 5_000,
): Promise<SentMail[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await messagesTo(address);
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) {
      throw new Error(
        `Mail sink: ${String(messages.length)}/${String(count)} messages to ${address}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function confirmationSecrets(message: SentMail): {
  code: string;
  token: string;
} {
  const code = /confirmation code: (\d{6})/.exec(message.text)?.[1];
  const token = /\/api\/auth\/confirm\?token=([\w-]{43})/.exec(
    message.text,
  )?.[1];
  if (!code || !token)
    throw new Error(`No code/link in mail:\n${message.text}`);
  return { code, token };
}
