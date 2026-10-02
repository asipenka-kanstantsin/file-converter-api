import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  CSRF_COOKIE,
  csrfCookieOptions,
  newCsrfToken,
} from '@/common/http/csrf';
import { RateLimit } from '@/common/http/rate-limit';
import { AppConfig } from '@/config';
import {
  toUserResponse,
  UserEnvelopeDto,
  type UserResponse,
} from '@/modules/users';

import { AuthService } from './auth.service';
import type { IssuedChallenge } from './challenges.types';
import { ConfirmWithCodeDto } from './dto/confirm-with-code.dto';
import { ConfirmWithLinkQueryDto } from './dto/confirm-with-link-query.dto';
import {
  type ConfirmationRequired,
  ConfirmationRequiredDto,
} from './dto/confirmation-required.dto';
import { registerResultSchema } from './dto/register-result.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';

function confirmationRequired(
  challenge: IssuedChallenge,
): ConfirmationRequired {
  return {
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    requiresConfirmation: true,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Get('confirm')
  @RateLimit('confirm')
  @ZodSerializerDto(UserEnvelopeDto)
  async confirmWithLink(
    @Query() { token }: ConfirmWithLinkQueryDto,
  ): Promise<{ user: UserResponse }> {
    return {
      user: toUserResponse(await this.authService.confirmWithToken(token)),
    };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit('confirm')
  @ZodSerializerDto(UserEnvelopeDto)
  async confirmWithCode(
    @Body() { challengeId, code }: ConfirmWithCodeDto,
  ): Promise<{ user: UserResponse }> {
    const user = await this.authService.confirmWithCode(challengeId, code);
    return { user: toUserResponse(user) };
  }

  @Get('csrf')
  @HttpCode(HttpStatus.NO_CONTENT)
  csrf(@Res({ passthrough: true }) response: Response): void {
    response.cookie(
      CSRF_COOKIE,
      newCsrfToken(),
      csrfCookieOptions(this.config.auth.cookieSecure),
    );
  }

  @Post('register')
  @RateLimit('mail')
  @ZodSerializerDto(registerResultSchema)
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ConfirmationRequired | { user: UserResponse }> {
    const result = await this.authService.register(input);
    if (result.kind === 'registered') {
      response.status(HttpStatus.CREATED);
      return { user: toUserResponse(result.user) };
    }
    response.status(HttpStatus.ACCEPTED);
    return confirmationRequired(result.challenge);
  }

  @Post('confirm/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit('mail')
  @ZodSerializerDto(ConfirmationRequiredDto)
  async resendConfirmation(
    @Body() { challengeId }: ResendConfirmationDto,
  ): Promise<ConfirmationRequired> {
    return confirmationRequired(
      await this.authService.resendConfirmation(challengeId),
    );
  }
}
