import { Logger } from '@nestjs/common';

import type { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

function service(stored: unknown): SettingsService {
  return new SettingsService({
    findValue: () => Promise.resolve(stored),
  } as unknown as SettingsRepository);
}

jest.mock('@nestjs-cls/transactional', () => ({
  Transactional:
    () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

describe('SettingsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the default when nothing is stored', async () => {
    await expect(
      service(undefined).isEnabled('confirmation.registration'),
    ).resolves.toBe(false);
  });

  it('returns a stored boolean', async () => {
    await expect(
      service(true).isEnabled('confirmation.registration'),
    ).resolves.toBe(true);
  });

  it('falls back to the default and warns on a corrupt value', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service('yes').isEnabled('confirmation.registration'),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      { key: 'confirmation.registration' },
      expect.any(String),
    );
  });

  it('lists every flag, stored or default, and logs who changed what', async () => {
    const stored = new Map<string, unknown>([
      ['confirmation.registration', true],
    ]);
    const repository = {
      findValues: jest.fn(() => Promise.resolve(stored)),
      upsertValues: jest.fn((values: Record<string, boolean>) => {
        for (const [key, value] of Object.entries(values))
          stored.set(key, value);
        return Promise.resolve();
      }),
    };
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const settings = new SettingsService(
      repository as unknown as SettingsRepository,
    );

    await expect(settings.all()).resolves.toEqual({
      'confirmation.login': false,
      'confirmation.registration': true,
    });
    await expect(
      settings.update(
        { id: 'a1', roleIds: [] },
        { 'confirmation.login': true },
      ),
    ).resolves.toEqual({
      'confirmation.login': true,
      'confirmation.registration': true,
    });
    expect(log).toHaveBeenCalledWith(
      { actorUserId: 'a1', changes: { 'confirmation.login': true } },
      'settings changed',
    );
  });
});
