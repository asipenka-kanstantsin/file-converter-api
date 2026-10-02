import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';

import {
  type FlagKey,
  FLAGS,
  type Flags,
  flagValueSchema,
} from './settings.definitions';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly settingsRepository: SettingsRepository) {}

  async isEnabled(key: FlagKey): Promise<boolean> {
    return this.resolve(key, await this.settingsRepository.findValue(key));
  }

  // Every flag with its effective value (decision A6).
  async all(): Promise<Flags> {
    const keys = Object.keys(FLAGS) as FlagKey[];
    const stored = await this.settingsRepository.findValues(keys);
    return Object.fromEntries(
      keys.map((key) => [key, this.resolve(key, stored.get(key))]),
    ) as Flags;
  }

  async update(actor: AuthUser, changes: Partial<Flags>): Promise<Flags> {
    const flags = await this.write(changes);
    this.logger.log({ actorUserId: actor.id, changes }, 'settings changed');
    return flags;
  }

  @Transactional()
  private async write(changes: Partial<Flags>): Promise<Flags> {
    await this.settingsRepository.upsertValues(changes);
    return this.all();
  }

  private resolve(key: FlagKey, stored: unknown): boolean {
    if (stored === undefined) return FLAGS[key];
    const parsed = flagValueSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    this.logger.warn({ key }, 'stored setting is invalid; using the default');
    return FLAGS[key];
  }
}
