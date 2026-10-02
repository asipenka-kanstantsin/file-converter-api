import { Logger } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import type { PrismaService } from '@/infrastructure/database';

import { HealthService } from './health.service';

function service(ping: () => Promise<void>): HealthService {
  return new HealthService({ ping } as unknown as PrismaService);
}

describe('HealthService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reports the database up', async () => {
    await expect(service(() => Promise.resolve()).check()).resolves.toEqual({
      checks: { database: 'up' },
      status: 'ok',
    });
  });

  it('throws SERVICE_UNAVAILABLE when the ping fails', async () => {
    const result = service(() => Promise.reject(new Error('down'))).check();

    await expect(result).rejects.toBeInstanceOf(AppException);
    await expect(result).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      context: { checks: { database: 'down' } },
      status: 503,
    });
  });

  it('treats a ping slower than 2 s as down', async () => {
    jest.useFakeTimers();
    const result = service(() => new Promise<void>(() => undefined)).check();
    jest.advanceTimersByTime(2_000);

    await expect(result).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
    });
  });

  it('answers liveness without checking dependencies', () => {
    expect(service(() => Promise.reject(new Error('unused'))).live()).toEqual({
      checks: {},
      status: 'ok',
    });
  });
});
