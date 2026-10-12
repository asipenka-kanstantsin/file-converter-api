import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:net';

import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

export interface SentMail {
  html: string;
  id: string;
  receivedAt: string;
  subject: string;
  text: string;
  to: string[];
}

export interface MailSink {
  readUrl: string;
  smtpPort: number;
  stop: () => Promise<void>;
}

function listen(server: {
  listen: (port: number, host: string, done: () => void) => unknown;
}): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (typeof address !== 'object' || !address) {
    throw new Error('mail sink did not bind a port');
  }
  return address.port;
}

// The e2e mailbox: a real SMTP server in the test process instead of the Mailpit container, so the
// app's nodemailer transport is still exercised end to end (18-testing) without docker. The
// messages are read back over a small HTTP API, because the suites run in their own processes.
export async function startMailSink(): Promise<MailSink> {
  let mailbox: SentMail[] = [];

  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    hideSTARTTLS: true,
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          mailbox.push({
            html: typeof parsed.html === 'string' ? parsed.html : '',
            id: randomUUID(),
            receivedAt: new Date().toISOString(),
            subject: parsed.subject ?? '',
            text: parsed.text ?? '',
            to: (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
              .flatMap((address) => address?.value ?? [])
              .map((address) => address.address ?? ''),
          });
          callback();
        })
        .catch(callback);
    },
  });
  // A socket error must not take the whole run down with an unhandled 'error' event.
  smtp.on('error', () => undefined);

  const reader = createServer((request, response) => {
    if (request.method === 'DELETE') {
      mailbox = [];
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(mailbox));
  });

  await Promise.all([listen(smtp), listen(reader)]);

  return {
    readUrl: `http://127.0.0.1:${String(portOf(reader))}/messages`,
    smtpPort: portOf(smtp.server),
    stop: () =>
      Promise.all([
        new Promise<void>((resolve) => {
          smtp.close(() => {
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          // Keep-alive sockets of the read API would otherwise hold the server open.
          reader.closeAllConnections();
          reader.close(() => {
            resolve();
          });
        }),
      ]).then(() => undefined),
  };
}
