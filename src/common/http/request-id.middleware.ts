import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const id = resolveRequestId(request.headers['x-request-id']);
  (request as Request & { id: string }).id = id;
  response.setHeader(REQUEST_ID_HEADER, id);
  next();
}
