import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  ImATeapotException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

import { AppException, ErrorCode, type ExceptionMapper } from '@/common/errors';

import { AllExceptionsFilter } from './all-exceptions.filter';

interface Captured {
  body?: unknown;
  status?: number;
}

function host(
  headers: Record<string, string> = {},
  headersSent = false,
): {
  captured: Captured;
  host: ArgumentsHost;
} {
  const captured: Captured = {};
  const response = {
    getHeader: (name: string) => headers[name],
    headersSent,
    json(body: unknown) {
      captured.body = body;
      return response;
    },
    status(status: number) {
      captured.status = status;
      return response;
    },
  };
  const request = { id: 'req-1', method: 'GET', route: { path: '/x' } };
  const argumentsHost = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { captured, host: argumentsHost };
}

describe('AllExceptionsFilter', () => {
  const teapotMapper: ExceptionMapper = (exception) =>
    exception === 'mapped-by-infrastructure'
      ? { code: ErrorCode.CONFLICT, status: HttpStatus.CONFLICT }
      : undefined;
  const filter = new AllExceptionsFilter([teapotMapper]);
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders an AppException with its status, code, message and context', () => {
    const { captured, host: h } = host();

    filter.catch(
      new AppException(ErrorCode.CONFLICT, HttpStatus.CONFLICT, { id: '1' }),
      h,
    );

    expect(captured).toEqual({
      body: {
        code: 'CONFLICT',
        context: { id: '1' },
        detail: expect.any(String) as string,
      },
      status: 409,
    });
  });

  it('maps zod validation failures to 400 VALIDATION_FAILED with field paths', () => {
    const result = z
      .object({ items: z.array(z.object({ name: z.string().min(3) })) })
      .safeParse({
        items: [{ name: 'ab' }],
      });
    const { captured, host: h } = host();

    filter.catch(new ZodValidationException(result.error), h);

    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({
      code: 'VALIDATION_FAILED',
      context: {
        fields: [
          {
            code: 'too_small',
            detail: expect.any(String) as string,
            path: 'items.0.name',
          },
        ],
      },
      detail: expect.any(String) as string,
    });
  });

  it('maps throttling to 429 with retryAfter from the Retry-After header and logs a warning', () => {
    const { captured, host: h } = host({ 'Retry-After': '42' });

    filter.catch(new ThrottlerException(), h);

    expect(captured).toMatchObject({
      body: { code: 'RATE_LIMITED', context: { retryAfter: 42 } },
      status: 429,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it.each([
    [new NotFoundException(), 404, 'ROUTE_NOT_FOUND'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [new BadRequestException(), 400, 'MALFORMED_REQUEST'],
  ])('maps framework %p to %i %s', (exception, status, code) => {
    const { captured, host: h } = host();

    filter.catch(exception, h);

    expect(captured).toMatchObject({ body: { code }, status });
  });

  it('asks the infrastructure mappers before falling back', () => {
    const { captured, host: h } = host();

    filter.catch('mapped-by-infrastructure', h);

    expect(captured).toMatchObject({ body: { code: 'CONFLICT' }, status: 409 });
  });

  it.each([
    [{ status: 400, type: 'entity.parse.failed' }, 400, 'MALFORMED_REQUEST'],
    [{ status: 413, type: 'entity.too.large' }, 413, 'PAYLOAD_TOO_LARGE'],
    [
      { status: 415, type: 'charset.unsupported' },
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [{ status: 400, type: 'request.aborted' }, 400, 'MALFORMED_REQUEST'],
  ])('maps the body-parser error %p to %i %s', (exception, status, code) => {
    const { captured, host: h } = host();

    filter.catch(exception, h);

    expect(captured).toMatchObject({ body: { code }, status });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 500, type: 'stream.encoding.set' }],
    [{ status: 403, type: 'entity.verify.failed' }],
    [{ status: '400', type: 'entity.parse.failed' }],
    [{ type: 'entity.parse.failed' }],
    [null],
  ])('does not mistake %p for a client error', (exception) => {
    const { captured, host: h } = host();

    filter.catch(exception, h);

    expect(captured.status).toBe(500);
  });

  it('only logs when the response has already been sent', () => {
    const { captured, host: h } = host({}, true);

    filter.catch(new Error('late failure'), h);

    expect(captured).toEqual({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', route: '/x' }),
      'request failed',
    );
  });

  it.each([[{}], [{ 'Retry-After': 'soon' }]])(
    'omits retryAfter when the header is missing or not a number (%p)',
    (headers) => {
      const { captured, host: h } = host(headers);

      filter.catch(new ThrottlerException(), h);

      expect(captured).toEqual({
        body: { code: 'RATE_LIMITED', detail: expect.any(String) as string },
        status: 429,
      });
    },
  );

  it('keeps the status of an unmapped client error as REQUEST_REJECTED', () => {
    const teapot = host();

    filter.catch(new ImATeapotException(), teapot.host);

    expect(teapot.captured).toMatchObject({
      body: { code: 'REQUEST_REJECTED' },
      status: 418,
    });
  });

  it('does not log ordinary client errors', () => {
    const { host: h } = host();

    filter.catch(new NotFoundException(), h);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('hides anything unknown behind a generic 500 and logs the error', () => {
    const { captured, host: h } = host();

    filter.catch(new Error('db password is hunter2'), h);

    expect(captured).toEqual({
      body: { code: 'INTERNAL_ERROR', detail: expect.any(String) as string },
      status: 500,
    });
    expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    expect(errorSpy).toHaveBeenCalled();
  });
});
