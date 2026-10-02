import {
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException, ErrorCode } from '@/common/errors';

// What the access-token guard proves about the caller (Notion "Авторизация" 1.3.1 step 5).
export interface AuthUser {
  id: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Only reachable on a @Public() route by mistake: fail closed.
    if (!user) {
      throw new AppException(
        ErrorCode.AUTH_UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }
    return user;
  },
);
