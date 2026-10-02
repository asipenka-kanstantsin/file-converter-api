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
