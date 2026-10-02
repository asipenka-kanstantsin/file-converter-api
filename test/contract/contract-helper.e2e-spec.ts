import type { Response } from 'supertest';

import {
  expectContract,
  expectErrorEnvelope,
  findPathTemplate,
} from '../helpers/contract';

function fake(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req-1',
      ...headers,
    },
    status,
  } as unknown as Response;
}

const healthy = { checks: {}, status: 'ok' };
const rateLimited = {
  code: 'RATE_LIMITED',
  context: { retryAfter: 5 },
  detail: 'x',
};

describe('contract helper', () => {
  it('accepts a response that matches the spec', () => {
    expect(() =>
      expectContract('get', '/health/live', fake(200, healthy)),
    ).not.toThrow();
  });

  it('rejects a body that does not match the schema', () => {
    expect(() =>
      expectContract('get', '/health/live', fake(200, { status: 'broken' })),
    ).toThrow(/body mismatch/);
  });

  it('falls back to `default` for generic errors but only with its codes', () => {
    expect(() =>
      expectContract(
        'get',
        '/health/live',
        fake(413, { code: 'PAYLOAD_TOO_LARGE', detail: 'x' }),
      ),
    ).not.toThrow();
    expect(() =>
      expectContract(
        'get',
        '/health/live',
        fake(409, { code: 'CONFLICT', detail: 'x' }),
      ),
    ).toThrow(/x-error-codes/);
    expect(() =>
      expectContract('get', '/health/live', fake(201, healthy)),
    ).toThrow(/undocumented success/);
    expect(() =>
      expectContract(
        'get',
        '/health/live',
        fake(500, { code: 'INTERNAL_ERROR', detail: 'x' }),
      ),
    ).toThrow(/unexpected server error/);
  });

  it('rejects an error code missing from x-error-codes', () => {
    expect(() =>
      expectContract(
        'get',
        '/health',
        fake(503, { code: 'CONFLICT', detail: 'x' }),
      ),
    ).toThrow(/x-error-codes/);
  });

  it('requires X-Request-Id and every required documented header', () => {
    const noRequestId = fake(200, healthy);
    delete (noRequestId.headers as Record<string, string>)['x-request-id'];

    expect(() => expectContract('get', '/health/live', noRequestId)).toThrow(
      /x-request-id/,
    );
    expect(() =>
      expectContract('get', '/api/openapi.json', fake(429, rateLimited)),
    ).toThrow(/Retry-After/);
    expect(() =>
      expectContract(
        'get',
        '/api/openapi.json',
        fake(429, rateLimited, { 'retry-after': 'soon' }),
      ),
    ).toThrow(/Retry-After=soon invalid/);
  });

  it('rejects an undocumented content type and an unknown path', () => {
    expect(() =>
      expectContract(
        'get',
        '/health/live',
        fake(200, 'ok', { 'content-type': 'text/plain' }),
      ),
    ).toThrow(/text\/plain/);
    expect(() => expectContract('get', '/nope', fake(200, {}))).toThrow(
      /no path/,
    );
    expect(findPathTemplate('/health?verbose=1')).toBe('/health');
  });

  it('checks the shared envelope for responses outside any operation', () => {
    expect(() =>
      expectErrorEnvelope(
        fake(404, { code: 'ROUTE_NOT_FOUND', detail: 'x' }),
        'ROUTE_NOT_FOUND',
      ),
    ).not.toThrow();
    expect(() =>
      expectErrorEnvelope(
        fake(404, { code: 'ROUTE_NOT_FOUND' }),
        'ROUTE_NOT_FOUND',
      ),
    ).toThrow(/ErrorEnvelope/);
    expect(() =>
      expectErrorEnvelope(
        fake(404, { code: 'CONFLICT', detail: 'x' }),
        'ROUTE_NOT_FOUND',
      ),
    ).toThrow(/expected ROUTE_NOT_FOUND/);
  });
});
