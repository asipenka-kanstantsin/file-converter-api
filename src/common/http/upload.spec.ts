import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type * as Multer from 'multer';
import { of } from 'rxjs';

import { requireFile, SingleFileUpload } from './upload';

jest.mock('multer', () => {
  const actual = jest.requireActual<typeof Multer>('multer');
  const factory = (): { single: () => unknown } => ({
    single:
      () =>
      (_req: unknown, _res: unknown, done: (error?: unknown) => void): void => {
        done(currentError);
      },
  });
  factory.memoryStorage = actual.memoryStorage;
  return {
    __esModule: true,
    default: factory,
    MulterError: actual.MulterError,
  };
});

let currentError: unknown;

function context(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of('ok') };

describe('SingleFileUpload', () => {
  const Interceptor = SingleFileUpload('file', 10);

  it('passes through when the upload parsed', async () => {
    currentError = undefined;
    await expect(
      new Interceptor({}).intercept(context(), next),
    ).resolves.toBeDefined();
  });

  it('maps an oversized file to 413 FILE_TOO_LARGE with the limit', async () => {
    const { MulterError } = jest.requireActual<typeof Multer>('multer');
    currentError = new MulterError('LIMIT_FILE_SIZE');

    await expect(
      new Interceptor({}).intercept(context(), next),
    ).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
      context: { maxBytes: 10 },
      status: 413,
    });
  });

  it('maps any other multipart failure to 400 MALFORMED_REQUEST', async () => {
    currentError = new Error('Unexpected end of form');

    await expect(
      new Interceptor({}).intercept(context(), next),
    ).rejects.toMatchObject({
      code: 'MALFORMED_REQUEST',
      status: 400,
    });
  });

  it('requires a file', () => {
    expect(() => requireFile(undefined)).toThrow(
      expect.objectContaining({ code: 'MALFORMED_REQUEST' }) as Error,
    );
  });
});
