import { Body, Controller, Get, Patch } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';

import { type FlagKey, FLAGS, type Flags } from './settings.definitions';
import { SettingsService } from './settings.service';

// Derived from FLAGS, so a new flag is settable as soon as it exists.
const flagsSchema = z.object(
  Object.fromEntries(
    Object.keys(FLAGS).map((key) => [key, z.boolean()]),
  ) as Record<FlagKey, z.ZodBoolean>,
);

// Unknown keys are refused, so a typo cannot silently change nothing.
const flagsPatchSchema = z
  .strictObject(flagsSchema.shape)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'empty' });

class SettingsDto extends createZodDto(z.object({ settings: flagsSchema })) {}
class SettingsPatchDto extends createZodDto(flagsPatchSchema) {}

// Decisions A6/A11: the admin switches e-mail confirmation per scenario without a deploy.
@Controller('admin/settings')
@RequirePermission('settings', 'manage')
export class SettingsAdminController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ZodSerializerDto(SettingsDto)
  async get(): Promise<{ settings: Flags }> {
    return { settings: await this.settings.all() };
  }

  @Patch()
  @ZodSerializerDto(SettingsDto)
  async update(
    @CurrentUser() actor: AuthUser,
    @Body() changes: SettingsPatchDto,
  ): Promise<{ settings: Flags }> {
    return { settings: await this.settings.update(actor, changes) };
  }
}
