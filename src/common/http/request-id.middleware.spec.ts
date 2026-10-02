import type { NextFunction, Request, Response } from 'express';

import { requestIdMiddleware, resolveRequestId } from './request-id.middleware';

describe('resolveRequestId', () => {
  it.each(['abc-123', 'A_b-9', 'x'.repeat(64)])('keeps a safe id %p', (id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it.each(['', 'has space', '<script>', 'x'.repeat(65), undefined, ['a']])(
    'replaces an unsafe id %p with a UUID',
    (id) => {
      expect(resolveRequestId(id)).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe('requestIdMiddleware', () => {
  it('stores the id on the request, echoes it and continues', () => {
    const request = {
      headers: { 'x-request-id': 'req-1' },
    } as unknown as Request & { id?: string };
    const setHeader = jest.fn();
    const next: NextFunction = jest.fn();

    requestIdMiddleware(request, { setHeader } as unknown as Response, next);

    expect(request.id).toBe('req-1');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-1');
    expect(next).toHaveBeenCalled();
  });
});
