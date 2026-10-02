import { z } from 'zod';

// Runtime flags an admin may change without a deploy (decision A6): key and default. A stored
// value that is not a boolean falls back to the default.
export const FLAGS = {
  'confirmation.login': false,
  'confirmation.registration': false,
} as const satisfies Record<string, boolean>;

export type FlagKey = keyof typeof FLAGS;
export type Flags = Record<FlagKey, boolean>;

export const flagValueSchema = z.boolean();
