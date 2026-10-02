import { Logger } from '@nestjs/common';

import type { AppConfig } from '@/config';
import type { PrismaService } from '@/infrastructure/database';

import {
  backoffSeconds,
  OutboxDispatcher,
  sanitizeError,
} from './outbox.dispatcher';
import { OutboxRegistry } from './outbox.registry';
import { PermanentJobError } from './outbox.types';

interface Row {
  attempts: number;
  id: string;
  payload: unknown;
  type: string;
}

interface UpdateCall {
  data: Record<string, unknown>;
  where: Record<string, unknown>;
}

function setup(
  rows: Row[],
  options: { buried?: number; jobsEnabled?: boolean; owned?: boolean } = {},
): {
  dispatcher: OutboxDispatcher;
  registry: OutboxRegistry;
  updates: () => UpdateCall[];
} {
  const updateMany = jest.fn((call: UpdateCall) =>
    Promise.resolve({
      count:
        'status' in call.where &&
        call.where.status === 'processing' &&
        'attempts' in call.where &&
        typeof call.where.attempts === 'number'
          ? options.owned === false
            ? 0
            : 1
          : (options.buried ?? 0),
    }),
  );
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    outboxMessage: { updateMany },
  } as unknown as PrismaService;
  const config = {
    jobs: { enabled: options.jobsEnabled ?? false, outboxPollIntervalMs: 1000 },
  } as AppConfig;
  const registry = new OutboxRegistry();
  return {
    dispatcher: new OutboxDispatcher(config, prisma, registry),
    registry,
    updates: () => updateMany.mock.calls.map(([call]) => call).slice(1),
  };
}

const row = (attempts = 1, type = 'mail.send'): Row => ({
  attempts,
  id: 'm1',
  payload: { secret: '123456' },
  type,
});

describe('OutboxDispatcher', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renews the lease, delivers, then marks done and drops the payload', async () => {
    const { dispatcher, registry, updates } = setup([row()]);
    const handler = jest.fn().mockResolvedValue(undefined);
    registry.register('mail.send', handler);

    await expect(dispatcher.tick()).resolves.toEqual({
      dead: 0,
      done: 1,
      retried: 0,
    });

    expect(handler).toHaveBeenCalledWith({ secret: '123456' });
    const [renew, done] = updates();
    expect(renew?.data).toEqual({ lockedUntil: expect.any(Date) as Date });
    expect(done).toEqual({
      data: expect.objectContaining({ payload: {}, status: 'done' }) as object,
      where: { attempts: 1, id: 'm1', status: 'processing' },
    });
  });

  it('skips a message whose claim another worker took over', async () => {
    const { dispatcher, registry } = setup([row()], { owned: false });
    const handler = jest.fn();
    registry.register('mail.send', handler);

    await expect(dispatcher.tick()).resolves.toEqual({
      dead: 0,
      done: 0,
      retried: 0,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('retries a transient failure with exponential backoff and a sanitized error', async () => {
    const { dispatcher, registry, updates } = setup([row(2)]);
    registry.register('mail.send', () =>
      Promise.reject(new Error('550 mailbox jane@example.com unavailable')),
    );
    const before = Date.now();

    await expect(dispatcher.tick()).resolves.toEqual({
      dead: 0,
      done: 0,
      retried: 1,
    });

    const data = updates()[1]?.data as {
      lastError: string;
      nextAttemptAt: Date;
    };
    expect(data).toMatchObject({
      lastError: '550 mailbox [email] unavailable',
      status: 'pending',
    });
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + 60_000,
    );
  });

  it.each([
    [
      'a permanent error',
      1,
      () => Promise.reject(new PermanentJobError('bad payload')),
    ],
    ['the last attempt', 8, () => Promise.reject(new Error('still down'))],
  ])(
    'moves the message to dead after %s and drops the payload',
    async (_label, attempts, handler) => {
      const { dispatcher, registry, updates } = setup([row(attempts)]);
      registry.register('mail.send', handler);

      await expect(dispatcher.tick()).resolves.toEqual({
        dead: 1,
        done: 0,
        retried: 0,
      });
      expect(updates()[1]?.data).toMatchObject({ payload: {}, status: 'dead' });
    },
  );

  it('kills a message nobody handles', async () => {
    const { dispatcher } = setup([row(1, 'unknown.type')]);

    await expect(dispatcher.tick()).resolves.toEqual({
      dead: 1,
      done: 0,
      retried: 0,
    });
  });

  it('buries rows abandoned on their last attempt', async () => {
    const { dispatcher } = setup([], { buried: 2 });

    await expect(dispatcher.tick()).resolves.toEqual({
      dead: 2,
      done: 0,
      retried: 0,
    });
  });

  it.each([
    [1, 30],
    [2, 60],
    [5, 480],
    [20, 3600],
  ])('backs off attempt %i by %i s (capped at 1 h)', (attempts, seconds) => {
    expect(backoffSeconds(attempts)).toBe(seconds);
  });

  it.each([
    [
      new Error('rcpt <jane.doe+x@example.co.uk> rejected'),
      'rcpt <[email]> rejected',
    ],
    ['plain string', 'plain string'],
  ])('sanitizes %p', (error, expected) => {
    expect(sanitizeError(error)).toBe(expected);
  });

  it('polls only when jobs are enabled, never overlapping, and stops on shutdown', async () => {
    jest.useFakeTimers();
    const disabled = setup([]);
    const tick = jest.spyOn(disabled.dispatcher, 'tick');
    disabled.dispatcher.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(tick).not.toHaveBeenCalled();

    const enabled = setup([], { jobsEnabled: true });
    let release: () => void = () => undefined;
    const slowTick = jest.spyOn(enabled.dispatcher, 'tick').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ dead: 0, done: 0, retried: 0 });
          };
        }),
    );
    enabled.dispatcher.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3_500);
    expect(slowTick).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(slowTick).toHaveBeenCalledTimes(2);

    enabled.dispatcher.onApplicationShutdown();
    release();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(slowTick).toHaveBeenCalledTimes(2);
  });

  it('logs and survives a failing poll', async () => {
    jest.useFakeTimers();
    const { dispatcher } = setup([], { jobsEnabled: true });
    jest.spyOn(dispatcher, 'tick').mockRejectedValue(new Error('db down'));

    dispatcher.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2_500);
    dispatcher.onApplicationShutdown();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      { error: 'db down' },
      'outbox poll failed',
    );
  });
});

describe('OutboxRegistry', () => {
  it('refuses a second handler for the same type', () => {
    const registry = new OutboxRegistry();
    registry.register('a', () => Promise.resolve());

    expect(() => {
      registry.register('a', () => Promise.resolve());
    }).toThrow(/already registered/);
    expect(registry.get('b')).toBeUndefined();
  });
});
