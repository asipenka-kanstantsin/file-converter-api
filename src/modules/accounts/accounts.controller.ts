import { Controller, Get, Header, Param } from '@nestjs/common';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import { uuidSchema } from '@/common/validation';
import { userStatusSchema } from '@/modules/users';

import { AccountsService } from './accounts.service';
import type { Profile } from './profile.policy';

const timestamp = z.date().transform((date) => date.toISOString());

export const profileSchema = z.object({
  email: z.string(),
  fields: z
    .object({
      createdAt: timestamp,
      displayName: z.string().nullable(),
      lastLoginAt: timestamp.nullable(),
      status: userStatusSchema,
    })
    .partial(),
  id: z.string(),
  photo: z.string().nullable(),
});

export class ProfileEnvelopeDto extends createZodDto(
  z.object({ profile: profileSchema }),
) {}

export class UserIdParamDto extends createZodDto(
  z.object({ userId: uuidSchema }),
) {}

@Controller('users')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  // Notion "Просмотр данных пользователя" 1.3.1: Self or users@read; rate-limited (1.4).
  @Get(':userId')
  @RateLimit('profile')
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(ProfileEnvelopeDto)
  async get(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
  ): Promise<{ profile: Profile }> {
    return { profile: await this.accounts.getProfile(actor, userId) };
  }
}
