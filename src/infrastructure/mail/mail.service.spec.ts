import { Logger } from '@nestjs/common';

import type { AppConfig } from '@/config';
import type { OutboxService } from '@/infrastructure/outbox';

import { MAIL_TEMPLATES } from './mail-templates';
import { MailService, maskEmail } from './mail.service';

const vars = {
  code: '012345',
  expiresInMinutes: 10,
  link: 'https://api.example.com/api/auth/confirm?token=abc',
  purpose: 'registration' as const,
};

function setup(): {
  enqueue: jest.Mock;
  send: jest.Mock;
  service: MailService;
} {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const send = jest.fn().mockResolvedValue({ messageId: 'm-1' });
  const service = new MailService(
    { mail: { from: 'App <no-reply@example.com>' } } as AppConfig,
    { enqueue } as unknown as OutboxService,
    { send },
  );
  return { enqueue, send, service };
}

describe('MailService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('enqueues a validated template message with its idempotency key', async () => {
    const { enqueue, service } = setup();

    await service.enqueue(
      'auth.confirmation',
      'jane@example.com',
      vars,
      'key-1',
    );

    expect(enqueue).toHaveBeenCalledWith({
      idempotencyKey: 'key-1',
      payload: { template: 'auth.confirmation', to: 'jane@example.com', vars },
      type: 'mail.send',
    });
  });

  it('refuses to enqueue variables the template does not accept', async () => {
    const { enqueue, service } = setup();

    await expect(
      service.enqueue(
        'auth.confirmation',
        'jane@example.com',
        { ...vars, code: 'abc' },
        'k',
      ),
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('renders and sends a queued message', async () => {
    const { send, service } = setup();

    await service.deliver({
      template: 'auth.confirmation',
      to: 'jane@example.com',
      vars,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'App <no-reply@example.com>',
        headers: { 'X-Mail-Template': 'auth.confirmation' },
        subject: 'Confirm your registration',
        to: 'jane@example.com',
      }),
    );
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'j***@example.com' }),
      'mail sent',
    );
  });

  it.each([
    [{ template: 'nope', to: 'jane@example.com', vars }],
    [{ template: 'auth.confirmation', to: 'not-an-email', vars }],
    [
      {
        template: 'auth.confirmation',
        to: 'jane@example.com',
        vars: { code: 'x' },
      },
    ],
  ])('treats an undeliverable payload %p as permanent', async (payload) => {
    const { send, service } = setup();

    await expect(service.deliver(payload)).rejects.toMatchObject({
      name: 'PermanentJobError',
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('mail templates', () => {
  it('escapes variables in HTML and keeps them verbatim in text', () => {
    const rendered = MAIL_TEMPLATES['auth.confirmation'].render({
      ...vars,
      link: 'https://x.example.com/?a=1&b="<script>"',
    });

    expect(rendered.html).toContain('a=1&amp;b=&quot;&lt;script&gt;&quot;');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.text).toContain('Your confirmation code: 012345');
  });
});

describe('maskEmail', () => {
  it.each([
    ['jane@example.com', 'j***@example.com'],
    ['x', 'x***@'],
  ])('masks %p as %p', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});
