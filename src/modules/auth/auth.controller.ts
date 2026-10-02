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

import { Public } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
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
import {
  ACCESS_COOKIE,
  LOGIN_BINDING_COOKIE,
  REFRESH_COOKIE,
  SessionCookies,
} from './session-cookies';
import { SessionResolver } from './session-resolver';

const bindingCookieSchema = z.object({ [LOGIN_BINDING_COOKIE]: z.string() });
const refreshCookieSchema = z.object({ [REFRESH_COOKIE]: z.string().min(1) });
const accessCookieSchema = z.object({ [ACCESS_COOKIE]: z.string().min(1) });

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

// Each handler opts out of the access-token guard on its own (decision A19): these are how a
// session starts, renews or ends. A handler added without @Public() is protected.
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfig,
    private readonly sessionCookies: SessionCookies,
    private readonly sessions: SessionResolver,
  ) {}

  @Get('confirm')
  @Public()
  @RateLimit('confirm')
  @ZodSerializerDto(UserEnvelopeDto)
  async confirmWithLink(
    @Query() { token }: ConfirmWithLinkQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: UserResponse }> {
    return this.confirmed(
      await this.authService.confirmWithToken(
        token,
        boundChallengeId(request),
        await this.sessionUserId(request),
      ),
      response,
    );
  }

  @Post('confirm')
  @Public()
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
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  csrf(@Res({ passthrough: true }) response: Response): void {
    response.cookie(
      CSRF_COOKIE,
      newCsrfToken(),
      csrfCookieOptions(this.config.auth.cookieSecure),
    );
  }

  @Post('login')
  @Public()
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

  // Notion "Авторизация" 1.4: logout cannot revoke an issued refresh token; it clears the cookies.
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    this.sessionCookies.clear(response);
    this.sessionCookies.clearLoginBinding(response);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const cookies = refreshCookieSchema.safeParse(request.cookies);
    try {
      const session = await this.authService.refresh(
        cookies.success ? cookies.data[REFRESH_COOKIE] : undefined,
      );
      this.sessionCookies.set(response, session);
    } catch (error: unknown) {
      // A refused refresh ends the session in this browser (09-auth → Refresh); a server error
      // does not, or a database hiccup would sign everyone out.
      if (
        error instanceof AppException &&
        error.code === ErrorCode.AUTH_REFRESH_INVALID
      ) {
        response.setHeader('Cache-Control', 'no-store');
        this.sessionCookies.clear(response);
      }
      throw error;
    }
  }

  @Post('register')
  @Public()
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
  @Public()
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

  // The account signed in in this browser, if any (the route itself is public).
  private async sessionUserId(request: Request): Promise<string | undefined> {
    const cookies = accessCookieSchema.safeParse(request.cookies);
    if (!cookies.success) return undefined;
    const session = await this.sessions.resolve(
      'access',
      cookies.data[ACCESS_COOKIE],
    );
    return session.ok ? session.user.id : undefined;
  }

  private confirmed(
    result: ConfirmResult,
    response: Response,
  ): { user: UserResponse } {
    if (result.session) {
      this.sessionCookies.set(response, result.session);
      this.sessionCookies.clearLoginBinding(response);
    }
    // A deletion confirmed by link: the session in this browser ended with the account.
    if (result.user.status === 'deleted') this.sessionCookies.clear(response);
    return { user: toUserResponse(result.user) };
  }
}
