import { ErrorCode } from './error-code';

// Single supported locale (decision H4). Every ErrorCode has exactly one message; the
// error-messages spec fails when a code is missing.
export const ERROR_MESSAGES = {
  [ErrorCode.AUTH_ACCOUNT_BLOCKED]: 'This account is blocked. Contact support.',
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
  [ErrorCode.AUTH_CHALLENGE_RESEND_LIMIT]:
    'This confirmation cannot be sent again. Start over.',
  [ErrorCode.AUTH_CHALLENGE_SESSION_REQUIRED]:
    'Open this link in a browser where you are signed in to this account, or enter the code.',
  [ErrorCode.AUTH_CODE_INVALID]: 'The code is incorrect.',
  [ErrorCode.AUTH_FORBIDDEN]: "You don't have permission to do this.",
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'The e-mail or password is incorrect.',
  [ErrorCode.AUTH_REFRESH_INVALID]:
    'Your session has ended. Please sign in again.',
  [ErrorCode.AUTH_UNAUTHENTICATED]: 'Sign in to continue.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state.',
  [ErrorCode.CONVERSION_NOT_SUPPORTED]: 'This conversion is not supported.',
  [ErrorCode.CONVERSION_TIMEOUT]:
    'The conversion took too long and was stopped.',
  [ErrorCode.CSRF_INVALID]: 'The request is missing a valid CSRF token.',
  [ErrorCode.FILE_EMPTY]: 'The file is empty.',
  [ErrorCode.FILE_ENCODING_INVALID]: 'The file must be UTF-8 encoded.',
  [ErrorCode.FILE_PARSE_ERROR]: 'The file is not valid for its format.',
  [ErrorCode.FILE_TOO_LARGE]: 'The file is too large.',
  [ErrorCode.FILE_TYPE_NOT_SUPPORTED]: 'This file type is not supported.',
  [ErrorCode.IMAGE_TOO_LARGE]: 'The image would be larger than allowed.',
  [ErrorCode.INTERNAL_ERROR]: 'Something went wrong. Please try again later.',
  [ErrorCode.MALFORMED_REQUEST]: 'The request could not be parsed.',
  [ErrorCode.PAGINATION_CURSOR_INVALID]:
    'The page cursor is invalid or belongs to other filters. Start from the first page.',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'The request body is too large.',
  [ErrorCode.PHOTO_NOT_FOUND]: 'The user has no photo.',
  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please retry later.',
  [ErrorCode.RBAC_ACTION_IN_USE]:
    'Some of the removed actions are still granted. Change those grants first.',
  [ErrorCode.RBAC_ACTION_NOT_ALLOWED]:
    'The permission does not have some of these actions.',
  [ErrorCode.RBAC_GRANT_DUPLICATE]:
    'This role already has a grant for this permission.',
  [ErrorCode.RBAC_GRANT_NOT_FOUND]: 'The grant does not exist.',
  [ErrorCode.RBAC_IN_USE]:
    'It is still used by grants or users. Remove those first.',
  [ErrorCode.RBAC_LAST_ADMIN]: 'At least one user must keep the admin role.',
  [ErrorCode.RBAC_PERMISSION_NAME_TAKEN]:
    'A permission with this name already exists.',
  [ErrorCode.RBAC_PERMISSION_NOT_FOUND]: 'The permission does not exist.',
  [ErrorCode.RBAC_ROLE_NAME_TAKEN]: 'A role with this name already exists.',
  [ErrorCode.RBAC_ROLE_NOT_FOUND]: 'The role does not exist.',
  [ErrorCode.RBAC_SYSTEM_ENTITY]:
    'Built-in roles, permissions and grants cannot be changed this way.',
  [ErrorCode.REQUEST_REJECTED]: 'The request was rejected.',
  [ErrorCode.RESULT_EXPIRED]: 'The saved result has expired and was removed.',
  [ErrorCode.RESULT_NOT_FOUND]: 'No saved result for this history item.',
  [ErrorCode.ROUTE_NOT_FOUND]: 'The requested resource does not exist.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable.',
  [ErrorCode.STORAGE_UNAVAILABLE]:
    'File storage is unavailable. Please try again later.',
  [ErrorCode.STRUCTURE_TOO_COMPLEX]:
    'The file is nested too deeply or is too large to convert.',
  [ErrorCode.SVG_UNSAFE]:
    'The SVG contains scripts, external references or other active content.',
  [ErrorCode.TRANSFORMATION_NOT_FOUND]: 'No such history item.',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]:
    'The request content type or encoding is not supported.',
  [ErrorCode.USER_EMAIL_TAKEN]: 'This e-mail is already registered.',
  [ErrorCode.USER_NOT_ACTIVE]:
    'The account has not confirmed its registration and cannot hold roles yet.',
  [ErrorCode.USER_NOT_FOUND]: 'The user does not exist.',
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
