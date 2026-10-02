import { ErrorCode } from './error-code';

// Single supported locale (decision H4). Every ErrorCode has exactly one message; the
// error-messages spec fails when a code is missing.
export const ERROR_MESSAGES = {
  [ErrorCode.AUTH_ACCOUNT_NOT_VERIFIED]:
    'Confirm your registration from the e-mail before signing in.',
  [ErrorCode.AUTH_CHALLENGE_EXPIRED]:
    'The confirmation has expired. Request a new code.',
  [ErrorCode.AUTH_CHALLENGE_INVALID]:
    'The confirmation is invalid or has already been used.',
  [ErrorCode.AUTH_CHALLENGE_LOCKED]:
    'Too many wrong codes. Request a new code.',
  [ErrorCode.AUTH_CHALLENGE_OTHER_BROWSER]:
    'Open the sign-in link in the browser where you started signing in, or enter the code.',
  [ErrorCode.AUTH_CODE_INVALID]: 'The code is incorrect.',
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'The e-mail or password is incorrect.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state.',
  [ErrorCode.CSRF_INVALID]: 'The request is missing a valid CSRF token.',
  [ErrorCode.INTERNAL_ERROR]: 'Something went wrong. Please try again later.',
  [ErrorCode.MALFORMED_REQUEST]: 'The request could not be parsed.',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'The request body is too large.',
  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please retry later.',
  [ErrorCode.REQUEST_REJECTED]: 'The request was rejected.',
  [ErrorCode.ROUTE_NOT_FOUND]: 'The requested resource does not exist.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable.',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]:
    'The request content type or encoding is not supported.',
  [ErrorCode.USER_EMAIL_TAKEN]: 'This e-mail is already registered.',
  [ErrorCode.VALIDATION_FAILED]: 'Some fields are invalid.',
} as const satisfies Record<ErrorCode, string>;

export const VALIDATION_MESSAGES: Readonly<Record<string, string>> = {
  custom: 'The value is invalid.',
  invalid_format: 'The value has an invalid format.',
  invalid_type: 'The value has the wrong type.',
  invalid_union: 'The value does not match any allowed shape.',
  invalid_value: 'The value is not one of the allowed values.',
  not_multiple_of: 'The value is not an allowed step.',
  password_too_weak: 'Use at least one letter and one digit.',
  too_big: 'The value is too large or too long.',
  too_small: 'The value is too small or too short.',
  unrecognized_keys: 'The object contains unknown keys.',
};

export function validationMessage(code: string): string {
  return VALIDATION_MESSAGES[code] ?? 'The value is invalid.';
}
