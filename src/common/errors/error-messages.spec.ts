import { ErrorCode } from './error-code';
import { ERROR_MESSAGES, validationMessage } from './error-messages';

describe('error messages', () => {
  it('has a non-empty message for every ErrorCode and no dead entries', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(
      Object.values(ErrorCode).sort(),
    );
    for (const message of Object.values(ERROR_MESSAGES))
      expect(message.length).toBeGreaterThan(0);
  });

  it('falls back to a generic message for unknown validation codes', () => {
    expect(validationMessage('too_small')).toMatch(/too small/);
    expect(validationMessage('something_new')).toBe('The value is invalid.');
  });
});
