import { Logger } from '@nestjs/common';

import type { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

function service(stored: unknown): SettingsService {
  return new SettingsService({
    findValue: () => Promise.resolve(stored),
  } as unknown as SettingsRepository);
}

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
});
