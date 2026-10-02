import { type AppException, ErrorCode } from '@/common/errors';

import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyQuerySchema,
} from './history';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('history query and cursor', () => {
  const query = historyQuerySchema.parse({ status: 'success', type: 'file' });
  const last = { createdAt: new Date('2026-06-01T00:00:00.123Z'), id: ID };

  it('round-trips a cursor for the same filters, whatever the limit', () => {
    const cursor = encodeHistoryCursor(query, last);

    expect(decodeHistoryCursor({ ...query, cursor, limit: 5 })).toEqual({
      at: '2026-06-01T00:00:00.123Z',
      id: ID,
    });
    expect(decodeHistoryCursor(query)).toBeUndefined();
  });

  it('refuses a cursor issued for other filters', () => {
    const cursor = encodeHistoryCursor(query, last);

    expect(() =>
      decodeHistoryCursor({ ...query, cursor, status: 'error' }),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.PAGINATION_CURSOR_INVALID,
      }) as AppException,
    );
  });

  it('accepts bounds with an offset up to milliseconds, from ≤ to', () => {
    expect(
      historyQuerySchema.safeParse({
        createdAtFrom: '2026-06-01T03:00:00.5+03:00',
        createdAtTo: '2026-06-01T00:00:00.500Z',
      }).success,
    ).toBe(true);
    // Written in year 0, but year 1 in UTC: what reaches SQL is the UTC form.
    expect(
      historyQuerySchema.parse({ createdAtTo: '0000-12-31T23:00:00-02:00' })
        .createdAtTo,
    ).toBe('0001-01-01T01:00:00.000Z');
    expect(
      historyQuerySchema.safeParse({
        createdAtFrom: '2026-06-01T00:00:01Z',
        createdAtTo: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
