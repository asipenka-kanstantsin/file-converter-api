import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';

import {
  type FlagKey,
  type NumberSettingKey,
  type SettingKey,
  SETTINGS,
  type Settings,
  type SettingValue,
} from './settings.definitions';
import { SettingsRepository } from './settings.repository';

const KEYS = Object.keys(SETTINGS) as SettingKey[];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly settingsRepository: SettingsRepository) {}

  async isEnabled(key: FlagKey): Promise<boolean> {
    return this.get(key);
  }

  async number(key: NumberSettingKey): Promise<number> {
    return this.get(key);
  }

  // Several numbers in one read.
  async numbers<K extends NumberSettingKey>(
    keys: readonly K[],
  ): Promise<Record<K, number>> {
    const stored = await this.settingsRepository.findValues(keys);
    return Object.fromEntries(
      keys.map((key) => [key, this.resolve(key, stored.get(key))]),
    ) as unknown as Record<K, number>;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return this.resolve(key, await this.settingsRepository.findValue(key));
  }

  // Every setting with its effective value (decisions A6, F1).
  async all(): Promise<Settings> {
    const stored = await this.settingsRepository.findValues(KEYS);
    return Object.fromEntries(
      KEYS.map((key) => [key, this.resolve(key, stored.get(key))]),
    ) as unknown as Settings;
  }

  async update(actor: AuthUser, changes: Partial<Settings>): Promise<Settings> {
    const settings = await this.write(changes);
    this.logger.log({ actorUserId: actor.id, changes }, 'settings changed');
    return settings;
  }

  @Transactional()
  private async write(changes: Partial<Settings>): Promise<Settings> {
    await this.settingsRepository.upsertValues(changes);
    return this.all();
  }

  private resolve<K extends SettingKey>(
    key: K,
    stored: unknown,
  ): SettingValue<K> {
    const { default: fallback, schema } = SETTINGS[key];
    if (stored === undefined) return fallback as SettingValue<K>;
    const parsed = schema.safeParse(stored);
    if (parsed.success) return parsed.data as SettingValue<K>;
    this.logger.warn({ key }, 'stored setting is invalid; using the default');
    return fallback as SettingValue<K>;
  }
}
