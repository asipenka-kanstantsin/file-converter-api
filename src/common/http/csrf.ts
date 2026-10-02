import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { CookieOptions, Request } from 'express';
import { z } from 'zod';

import { AppException, ErrorCode } from '@/common/errors';

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const cookiesSchema = z.object({ [CSRF_COOKIE]: z.string().min(1) });

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: false, path: '/', sameSite: 'lax', secure };
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Double-submit CSRF protection for every unsafe method, public ones included (09-auth).
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const cookies = cookiesSchema.safeParse(request.cookies);
    const header = request.headers[CSRF_HEADER];
    if (
      cookies.success &&
      typeof header === 'string' &&
      sameToken(cookies.data[CSRF_COOKIE], header)
    ) {
      return true;
    }
    throw new AppException(ErrorCode.CSRF_INVALID, HttpStatus.FORBIDDEN);
  }
}
