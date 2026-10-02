import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { userStatusSchema } from '../users.types';

export const userResponseSchema = z.object({
  createdAt: z.date().transform((date) => date.toISOString()),
  email: z.string(),
  id: z.string(),
  status: userStatusSchema,
});

export const userEnvelopeSchema = z.object({ user: userResponseSchema });

export type UserResponse = z.input<typeof userResponseSchema>;

export class UserEnvelopeDto extends createZodDto(userEnvelopeSchema) {}
