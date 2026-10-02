import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Res,
  type StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { createZodDto, ZodSerializerDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '@/common/decorators';
import { RateLimit } from '@/common/http/rate-limit';
import { streamFile } from '@/common/http/streaming';
import { requireFile, SingleFileUpload } from '@/common/http/upload';
import { emailSchema, uuidSchema } from '@/common/validation';
import { type OwnerConfirmation, SessionCookies } from '@/modules/auth';
import { userStatusSchema } from '@/modules/users';

import { AccountsService } from './accounts.service';
import { PHOTO_MAX_BYTES } from './photo.processor';
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

class ProfileEnvelopeDto extends createZodDto(
  z.object({ profile: profileSchema }),
) {}

class UserIdParamDto extends createZodDto(z.object({ userId: uuidSchema })) {}

// Decision P5: unknown keys are refused (400), so a typo is never silently ignored; which known
// keys a caller may send is the service's 403.
const profilePatchSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).nullable(),
    email: emailSchema,
    status: z.enum(['active', 'blocked']),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'empty' });

class ProfilePatchDto extends createZodDto(profilePatchSchema) {}

class EmailChangeDto extends createZodDto(
  z.object({ newEmail: emailSchema }),
) {}

// Variant A `{ challengeId, code }` or variant B `{ token }` (Notion 1.3.3), never both; the
// same shape confirms an account deletion.
const ownerConfirmationSchema = z
  .strictObject({
    challengeId: uuidSchema.optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .refine(
    ({ challengeId, code, token }) =>
      token === undefined
        ? challengeId !== undefined && code !== undefined
        : challengeId === undefined && code === undefined,
    { message: 'code_or_token' },
  );

class OwnerConfirmationDto extends createZodDto(ownerConfirmationSchema) {}

function toOwnerConfirmation(input: {
  challengeId?: string;
  code?: string;
  token?: string;
}): OwnerConfirmation {
  return input.token === undefined
    ? { challengeId: input.challengeId ?? '', code: input.code ?? '' }
    : { token: input.token };
}

// Notion 1.3.1: an optional reason, for audit and support. The whole body is optional too (a
// DELETE usually has none), so this schema is applied as the parameter's own pipe.
const deletionRequestSchema = z
  .strictObject({ reason: z.string().trim().min(1).max(500).optional() })
  .optional();

class ChallengeDto extends createZodDto(
  z.object({
    challengeId: z.string(),
    expiresAt: timestamp,
    requiresConfirmation: z.literal(true),
  }),
) {}

@Controller('users')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly sessionCookies: SessionCookies,
  ) {}

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

  // Notion "Изменение данных пользователя" 1.3.1 and 1.3.4 (H6).
  @Patch(':userId')
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(ProfileEnvelopeDto)
  async update(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Body() patch: ProfilePatchDto,
  ): Promise<{ profile: Profile }> {
    return {
      profile: await this.accounts.updateProfile(actor, userId, patch),
    };
  }

  // 1.3.2: 200 with a pending confirmation, as Notion specifies.
  @Post(':userId/email-change')
  @HttpCode(HttpStatus.OK)
  @RateLimit('mail')
  @ZodSerializerDto(ChallengeDto)
  async startEmailChange(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Body() { newEmail }: EmailChangeDto,
  ): Promise<{
    challengeId: string;
    expiresAt: Date;
    requiresConfirmation: true;
  }> {
    const issued = await this.accounts.startEmailChange(
      actor,
      userId,
      newEmail,
    );
    return { ...issued, requiresConfirmation: true };
  }

  // 1.3.3: the code (variant A) or the link token (variant B).
  @Post(':userId/email-change/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit('confirm')
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(ProfileEnvelopeDto)
  async confirmEmailChange(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Body() { challengeId, code, token }: OwnerConfirmationDto,
  ): Promise<{ profile: Profile }> {
    const input = toOwnerConfirmation({ challengeId, code, token });
    return {
      profile: await this.accounts.confirmEmailChange(actor, userId, input),
    };
  }

  // Notion "Удаление пользователя" 1.3.1 (H7): Self → 202 and an e-mailed confirmation;
  // another account with users@delete → 204, done.
  // `mail` group: a Self request mails a fresh code each time (09-auth).
  @Delete(':userId')
  @RateLimit('mail')
  async requestDeletion(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Body(new ZodValidationPipe(deletionRequestSchema))
    body: z.infer<typeof deletionRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<
    | undefined
    | { challengeId: string; expiresAt: string; requiresConfirmation: true }
  > {
    const result = await this.accounts.requestDeletion(
      actor,
      userId,
      body?.reason,
    );
    if (result.kind === 'deleted') {
      response.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    response.status(HttpStatus.ACCEPTED);
    return {
      challengeId: result.challenge.challengeId,
      expiresAt: result.challenge.expiresAt.toISOString(),
      requiresConfirmation: true,
    };
  }

  // The account is gone: this browser's session cookies go with it.
  @Post(':userId/delete/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit('confirm')
  async confirmDeletion(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Body() { challengeId, code, token }: OwnerConfirmationDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.accounts.confirmDeletion(
      actor,
      userId,
      toOwnerConfirmation({ challengeId, code, token }),
    );
    this.sessionCookies.clear(response);
  }

  // Decision P4: multipart field `file`, PNG or JPEG up to 5 MB.
  @Put(':userId/photo')
  @RateLimit('upload')
  @UseInterceptors(SingleFileUpload('file', PHOTO_MAX_BYTES))
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(ProfileEnvelopeDto)
  async replacePhoto(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ profile: Profile }> {
    return {
      profile: await this.accounts.replacePhoto(
        actor,
        userId,
        requireFile(file).buffer,
      ),
    };
  }

  // Streamed through the API after the access check; never a storage URL (F4).
  @Get(':userId/photo')
  @RateLimit('profile')
  @Header('Cache-Control', 'private, no-store')
  async photo(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const photo = await this.accounts.openPhoto(actor, userId);
    return streamFile(
      photo.body,
      { disposition: 'inline', length: photo.size, type: photo.contentType },
      response,
    );
  }

  @Delete(':userId/photo')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePhoto(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
  ): Promise<void> {
    await this.accounts.removePhoto(actor, userId);
  }
}
