import { z } from 'zod';

const MAILPIT = 'http://localhost:8025/api/v1';

const searchSchema = z.object({
  messages: z.array(
    z.object({ Created: z.string(), ID: z.string(), Subject: z.string() }),
  ),
});
const messageSchema = z.object({
  HTML: z.string(),
  Subject: z.string(),
  Text: z.string(),
  To: z.array(z.object({ Address: z.string() })),
});

export type MailpitMessage = z.infer<typeof messageSchema>;

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/messages`, { method: 'DELETE' });
}

export async function messagesTo(address: string): Promise<MailpitMessage[]> {
  const search = await fetch(
    `${MAILPIT}/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  const { messages } = searchSchema.parse(await search.json());
  // Newest first, whatever order the search API uses.
  const ordered = [...messages].sort((a, b) =>
    b.Created.localeCompare(a.Created),
  );
  return Promise.all(
    ordered.map(async ({ ID }) => {
      const response = await fetch(`${MAILPIT}/message/${ID}`);
      return messageSchema.parse(await response.json());
    }),
  );
}

// Polls with a deadline instead of sleeping (18-testing).
export async function waitForMessageTo(
  address: string,
  count = 1,
  timeoutMs = 5_000,
): Promise<MailpitMessage[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await messagesTo(address);
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) {
      throw new Error(
        `Mailpit: ${String(messages.length)}/${String(count)} messages to ${address}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function confirmationSecrets(message: MailpitMessage): {
  code: string;
  token: string;
} {
  const code = /confirmation code: (\d{6})/.exec(message.Text)?.[1];
  const token = /\/api\/auth\/confirm\?token=([\w-]{43})/.exec(
    message.Text,
  )?.[1];
  if (!code || !token)
    throw new Error(`No code/link in mail:\n${message.Text}`);
  return { code, token };
}
