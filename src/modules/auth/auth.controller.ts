import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

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

import { AuthService, type ConfirmResult } from './auth.service';
import type { IssuedChallenge } from './challenges.types';
import { ConfirmWithCodeDto } from './dto/confirm-with-code.dto';
import { ConfirmWithLinkQueryDto } from './dto/confirm-with-link-query.dto';
import {
  type ConfirmationRequired,
  ConfirmationRequiredDto,
} from './dto/confirmation-required.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { userOrConfirmationSchema } from './dto/user-or-confirmation.dto';
import { LOGIN_BINDING_COOKIE, SessionCookies } from './session-cookies';

const bindingCookieSchema = z.object({ [LOGIN_BINDING_COOKIE]: z.string() });

function boundChallengeId(request: Request): string | undefined {
  const parsed = bindingCookieSchema.safeParse(request.cookies);
  return parsed.success ? parsed.data[LOGIN_BINDING_COOKIE] : undefined;
}

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
    private readonly sessionCookies: SessionCookies,
  ) {}

  @Get('confirm')
  @RateLimit('confirm')
  @ZodSerializerDto(UserEnvelopeDto)
  async confirmWithLink(
    @Query() { token }: ConfirmWithLinkQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: UserResponse }> {
    return this.confirmed(
      await this.authService.confirmWithToken(token, boundChallengeId(request)),
      response,
    );
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit('confirm')
  @ZodSerializerDto(UserEnvelopeDto)
  async confirmWithCode(
    @Body() { challengeId, code }: ConfirmWithCodeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: UserResponse }> {
    return this.confirmed(
      await this.authService.confirmWithCode(challengeId, code),
      response,
    );
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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(userOrConfirmationSchema)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ConfirmationRequired | { user: UserResponse }> {
    const result = await this.authService.login(input, request.ip ?? 'unknown');
    if (result.kind === 'signed_in') {
      this.sessionCookies.set(response, result.session);
      return { user: toUserResponse(result.user) };
    }
    response.status(HttpStatus.ACCEPTED);
    this.sessionCookies.bindLogin(response, result.challenge.challengeId);
    return confirmationRequired(result.challenge);
  }

  @Post('register')
  @RateLimit('mail')
  @ZodSerializerDto(userOrConfirmationSchema)
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
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ConfirmationRequired> {
    const issued = await this.authService.resendConfirmation(challengeId);
    // The resend restarts the 10-minute window; the browser binding must last as long (A17).
    if (
      issued.purpose === 'login' &&
      boundChallengeId(request) === challengeId
    ) {
      this.sessionCookies.bindLogin(response, challengeId);
    }
    return confirmationRequired(issued);
  }

  private confirmed(
    result: ConfirmResult,
    response: Response,
  ): { user: UserResponse } {
    if (result.session) {
      this.sessionCookies.set(response, result.session);
      this.sessionCookies.clearLoginBinding(response);
    }
    return { user: toUserResponse(result.user) };
  }
}
