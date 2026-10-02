import { z } from 'zod';

// Runtime flags an admin may change without a deploy (decision A6): key and default. A stored
// value that is not a boolean falls back to the default.
export const FLAGS = {
  'confirmation.registration': false,
} as const satisfies Record<string, boolean>;

export type FlagKey = keyof typeof FLAGS;

export const flagValueSchema = z.boolean();
