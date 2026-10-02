import { Module } from '@nestjs/common';

import { SettingsAdminController } from './settings-admin.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsAdminController],
  exports: [SettingsService],
  providers: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
