import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

// Decision A8: 8–128 characters with at least one letter and one digit. The upper bound also
// caps the argon2 hashing cost an attacker can trigger.
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    message: 'password_too_weak',
  });

export const uuidSchema = z.uuid();
