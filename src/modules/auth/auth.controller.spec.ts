import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppException, ErrorCode } from '@/common/errors';
import type { AppConfig } from '@/config';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { SessionCookies } from './session-cookies';
import type { SessionResolver } from './session-resolver';

function setup(refresh: jest.Mock): {
  clear: jest.Mock;
  controller: AuthController;
  response: Response;
} {
  const clear = jest.fn();
  const controller = new AuthController(
    { refresh } as unknown as AuthService,
    {} as AppConfig,
    { clear, set: jest.fn() } as unknown as SessionCookies,
    {} as SessionResolver,
  );
  const response = { setHeader: jest.fn() } as unknown as Response;
  return { clear, controller, response };
}

const request = { cookies: { refresh_token: 'r' } } as unknown as Request;

describe('AuthController.refresh', () => {
  it('clears the session cookies when the refresh is refused', async () => {
    const refused = new AppException(
      ErrorCode.AUTH_REFRESH_INVALID,
      HttpStatus.UNAUTHORIZED,
    );
    const { clear, controller, response } = setup(
      jest.fn().mockRejectedValue(refused),
    );

    await expect(controller.refresh(request, response)).rejects.toBe(refused);
    expect(clear).toHaveBeenCalledWith(response);
  });

  it('keeps the cookies when the refresh fails with a server error', async () => {
    const outage = new Error('connection terminated');
    const { clear, controller, response } = setup(
      jest.fn().mockRejectedValue(outage),
    );

    await expect(controller.refresh(request, response)).rejects.toBe(outage);
    expect(clear).not.toHaveBeenCalled();
  });
});
