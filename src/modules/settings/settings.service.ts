import { Injectable, Logger } from '@nestjs/common';

import { type FlagKey, FLAGS, flagValueSchema } from './settings.definitions';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly settingsRepository: SettingsRepository) {}

  async isEnabled(key: FlagKey): Promise<boolean> {
    const stored = await this.settingsRepository.findValue(key);
    if (stored === undefined) return FLAGS[key];
    const parsed = flagValueSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    this.logger.warn({ key }, 'stored setting is invalid; using the default');
    return FLAGS[key];
  }
}
