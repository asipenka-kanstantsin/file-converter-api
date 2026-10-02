import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { emailSchema } from '@/common/validation';

// No password policy on sign-in: a policy change must not lock existing accounts out.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export class LoginDto extends createZodDto(loginSchema) {}
