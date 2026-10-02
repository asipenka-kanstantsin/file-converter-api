import { ErrorCode } from '@/common/errors';
import type { AppConfig } from '@/config';
import type { MailService } from '@/infrastructure/mail';

import { hashCode, hashToken, sameHash } from './challenge-secrets';
import type { ChallengesRepository } from './challenges.repository';
import { ChallengesService } from './challenges.service';
import type { Challenge } from './challenges.types';

const PEPPER = 'p'.repeat(32);
const config = {
  app: { publicUrl: 'https://api.example.com' },
  auth: { otpPepper: PEPPER },
  confirmation: { maxAttempts: 5, resendCooldownSeconds: 60, ttlSeconds: 600 },
} as AppConfig;

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    attempts: 0,
    codeHash: hashCode('123456', PEPPER),
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    id: 'c1',
    lastSentAt: new Date(Date.now() - 120_000),
    purpose: 'registration',
    tokenVersion: null,
    user: { email: 'jane@example.com', id: 'u1' },
    ...overrides,
  };
}

function setup(repository: Partial<ChallengesRepository>): {
  enqueue: jest.Mock;
  service: ChallengesService;
} {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const service = new ChallengesService(
    repository as ChallengesRepository,
    config,
    { enqueue } as unknown as MailService,
  );
  return { enqueue, service };
}

describe('ChallengesService', () => {
  it('issues a hashed code and token and mails both in plain text', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ expiresAt: new Date(), id: 'c1' });
    const { enqueue, service } = setup({ create });

    await service.issue('registration', {
      email: 'jane@example.com',
      id: 'u1',
    });

    const [, , secrets] = create.mock.calls[0] as [
      string,
      string,
      { codeHash: string; tokenHash: string },
    ];
    const [template, to, vars, key] = enqueue.mock.calls[0] as [
      string,
      string,
      { code: string; link: string },
      string,
    ];
    const token = /token=([\w-]{43})$/.exec(vars.link)?.[1] ?? '';
    expect(template).toBe('auth.confirmation');
    expect(to).toBe('jane@example.com');
    expect(vars.code).toMatch(/^\d{6}$/);
    expect(sameHash(secrets.codeHash, hashCode(vars.code, PEPPER))).toBe(true);
    expect(secrets.tokenHash).toBe(hashToken(token));
    expect(key).toMatch(/^auth\.confirmation:c1:\d+$/);
  });

  it('accepts the right code after reserving an attempt, without consuming', async () => {
    const consume = jest.fn();
    const reserveAttempt = jest
      .fn()
      .mockResolvedValue({ attempts: 1, codeHash: hashCode('123456', PEPPER) });
    const { service } = setup({
      consume,
      findById: () => Promise.resolve(challenge()),
      reserveAttempt,
    });

    await expect(service.verifyCode('c1', '123456')).resolves.toMatchObject({
      id: 'c1',
    });
    expect(reserveAttempt).toHaveBeenCalledWith('c1', 5);
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null, ErrorCode.AUTH_CHALLENGE_INVALID],
    [
      'consumed',
      challenge({ consumedAt: new Date() }),
      ErrorCode.AUTH_CHALLENGE_INVALID,
    ],
    ['locked', challenge({ attempts: 5 }), ErrorCode.AUTH_CHALLENGE_LOCKED],
    [
      'expired',
      challenge({ expiresAt: new Date(Date.now() - 1) }),
      ErrorCode.AUTH_CHALLENGE_EXPIRED,
    ],
  ])('refuses a %s challenge', async (_label, found, code) => {
    const { service } = setup({ findById: () => Promise.resolve(found) });

    await expect(service.verifyCode('c1', '123456')).rejects.toMatchObject({
      code,
    });
  });

  it('reports the attempts left for a wrong code, then locks on the last one', async () => {
    const reserved = (attempts: number): object => ({
      attempts,
      codeHash: hashCode('123456', PEPPER),
    });
    const reserveAttempt = jest
      .fn()
      .mockResolvedValueOnce(reserved(1))
      .mockResolvedValueOnce(reserved(5));
    const { service } = setup({
      findById: () => Promise.resolve(challenge()),
      reserveAttempt,
    });

    await expect(service.verifyCode('c1', '000000')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CODE_INVALID,
      context: { attemptsLeft: 4 },
    });
    await expect(service.verifyCode('c1', '000000')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_LOCKED,
      status: 423,
    });
  });

  it('compares against the hash returned by the reservation, not the earlier read', async () => {
    const { service } = setup({
      findById: () => Promise.resolve(challenge()),
      reserveAttempt: () =>
        Promise.resolve({ attempts: 1, codeHash: hashCode('654321', PEPPER) }),
    });

    await expect(service.verifyCode('c1', '123456')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CODE_INVALID,
    });
    await expect(service.verifyCode('c1', '654321')).resolves.toMatchObject({
      id: 'c1',
    });
  });

  it('explains a lost reservation race by the current state', async () => {
    const findById = jest
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(challenge({ attempts: 5 }))
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(challenge());
    const { service } = setup({
      findById,
      reserveAttempt: () => Promise.resolve(null),
    });

    await expect(service.verifyCode('c1', '123456')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_LOCKED,
    });
    await expect(service.verifyCode('c1', '123456')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_INVALID,
    });
  });

  it('refuses an unknown or used magic link', async () => {
    const unknown = setup({
      findByTokenHash: () => Promise.resolve(null),
    }).service;
    const used = setup({
      findByTokenHash: () =>
        Promise.resolve(challenge({ consumedAt: new Date() })),
    }).service;

    await expect(unknown.verifyToken('t')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_INVALID,
    });
    await expect(used.verifyToken('t')).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_INVALID,
    });
  });

  it('loses a concurrent consumption race with AUTH_CHALLENGE_INVALID', async () => {
    const { service } = setup({ consume: () => Promise.resolve(false) });

    await expect(service.consume(challenge())).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_INVALID,
    });
  });

  it('rotates the secrets and mails them when the cooldown has passed', async () => {
    const rotateIfDue = jest.fn().mockResolvedValue(true);
    const { enqueue, service } = setup({
      findById: () => Promise.resolve(challenge()),
      rotateIfDue,
    });

    await expect(service.resend('c1')).resolves.toMatchObject({
      challengeId: 'c1',
      userId: 'u1',
    });
    const [, sentBefore] = rotateIfDue.mock.calls[0] as [string, Date];
    expect(Date.now() - sentBefore.getTime()).toBeGreaterThanOrEqual(59_000);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('answers 429 with retryAfter when the conditional rotation did not happen', async () => {
    const { enqueue, service } = setup({
      findById: () =>
        Promise.resolve(
          challenge({ lastSentAt: new Date(Date.now() - 10_000) }),
        ),
      rotateIfDue: () => Promise.resolve(false),
    });

    await expect(service.resend('c1')).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
      context: { retryAfter: 50 },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
