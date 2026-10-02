import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import { type AuthenticatedRequest, IS_PUBLIC_KEY } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';

import { ACCESS_COOKIE } from './session-cookies';
import { SessionResolver } from './session-resolver';

const cookiesSchema = z.object({ [ACCESS_COOKIE]: z.string().min(1) });

// Global: every route needs a valid `access_token` cookie unless it is @Public() (decision A19,
// Notion "Авторизация" 1.3.1). One 401 for every failure; the reason goes to the log only.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = cookiesSchema.safeParse(request.cookies);
    const session = await this.sessions.resolve(
      'access',
      cookies.success ? cookies.data[ACCESS_COOKIE] : undefined,
    );
    if (!session.ok) {
      // No cookie at all is routine (a signed-out tab, a crawler); a bad token is worth a warning.
      const level = session.failure === 'missing' ? 'debug' : 'warn';
      this.logger[level](
        {
          method: request.method,
          path: request.path,
          reason: session.failure,
          userId: session.userId,
        },
        'access denied',
      );
      throw new AppException(
        ErrorCode.AUTH_UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.user = { id: session.user.id, roleIds: session.user.roleIds };
    return true;
  }
}
