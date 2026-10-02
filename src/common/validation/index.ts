import { z } from 'zod';

// `.invalid` is reserved (RFC 2606) and used for deleted accounts' tombstones (D1): nobody may
// claim such an address and block a deletion.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .refine((email) => !email.endsWith('.invalid'), {
    message: 'reserved_domain',
  });

// Decision A8: 8–128 characters with at least one letter and one digit. The upper bound also
// caps the argon2 hashing cost an attacker can trigger.
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    message: 'password_too_weak',
  });

// Canonical lowercase: ids are compared as strings (Self checks, audit), and Postgres would
// otherwise match an uppercase id that a string comparison does not.
export const uuidSchema = z.uuid().transform((id) => id.toLowerCase());

const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// An instant as `Date#toISOString` writes it, that Postgres accepts too: a real date (no
// 30 February, no hour 25) and no year 0, which JavaScript takes and a timestamptz cast refuses.
// Cursor keys are checked with it before they reach SQL.
export function isExactInstant(value: string): boolean {
  if (!UTC_MILLIS.test(value)) return false;
  const date = new Date(value);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.toISOString() === value
  );
}

// A query bound: ISO-8601 with an offset, at most millisecond precision (what is stored: a finer
// bound would be truncated past the rows it should exclude), normalised to the UTC form above.
// Postgres checks the written year before the offset, so only the normalised form reaches SQL,
// and only years 1–9999 (no year 0; `toISOString` writes later years as `+010000`).
export const instantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => !/\.\d{4}/.test(value), { message: 'instant_precision' })
  .transform((value) => new Date(value))
  .refine(
    (date) => date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999,
    { message: 'instant_out_of_range' },
  )
  .transform((date) => date.toISOString());
