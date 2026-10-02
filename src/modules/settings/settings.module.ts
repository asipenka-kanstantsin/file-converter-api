import { Module } from '@nestjs/common';

import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  exports: [SettingsService],
  providers: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
