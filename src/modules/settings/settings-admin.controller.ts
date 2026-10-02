import { Body, Controller, Get, Patch } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';

import {
  type SettingKey,
  SETTINGS,
  type Settings,
} from './settings.definitions';
import { SettingsService } from './settings.service';

// Derived from SETTINGS, so a new setting is settable as soon as it exists, with its own bounds.
const settingsSchema = z.object(
  Object.fromEntries(
    Object.entries(SETTINGS).map(([key, { schema }]) => [key, schema]),
  ) as { [K in SettingKey]: (typeof SETTINGS)[K]['schema'] },
);

// Unknown keys are refused, so a typo cannot silently change nothing.
const settingsPatchSchema = z
  .strictObject(settingsSchema.shape)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'empty' });

class SettingsDto extends createZodDto(
  z.object({ settings: settingsSchema }),
) {}
class SettingsPatchDto extends createZodDto(settingsPatchSchema) {}

// Decisions A6/A11/F1: e-mail confirmation per scenario, conversion limits and retention,
// changed without a deploy.
@Controller('admin/settings')
@RequirePermission('settings', 'manage')
export class SettingsAdminController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ZodSerializerDto(SettingsDto)
  async get(): Promise<{ settings: Settings }> {
    return { settings: await this.settings.all() };
  }

  @Patch()
  @ZodSerializerDto(SettingsDto)
  async update(
    @CurrentUser() actor: AuthUser,
    @Body() changes: SettingsPatchDto,
  ): Promise<{ settings: Settings }> {
    return { settings: await this.settings.update(actor, changes) };
  }
}
