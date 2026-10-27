import { ErrorCode } from '@/common/errors';

import { UserSlots } from './user-slots';

describe('UserSlots', () => {
  it('refuses a conversion once the account is at its ceiling, and only that account', () => {
    const slots = new UserSlots(1);
    const release = slots.take('a');

    expect(() => slots.take('a')).toThrow(
      expect.objectContaining({ code: ErrorCode.RATE_LIMITED }) as Error,
    );
    // A second account still converts: the point of the ceiling.
    expect(() => slots.take('b')).not.toThrow();

    release();
    expect(() => slots.take('a')).not.toThrow();
  });

  it('forgets an account once it holds nothing, and ignores a repeated release', () => {
    const slots = new UserSlots(2);
    const first = slots.take('a');
    const second = slots.take('a');

    expect(slots.heldBy('a')).toBe(2);
    first();
    first();
    expect(slots.heldBy('a')).toBe(1);
    second();
    expect(slots.heldBy('a')).toBe(0);
  });
});
