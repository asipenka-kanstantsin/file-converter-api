import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const confirmationRequiredSchema = z.object({
  challengeId: z.string(),
  expiresAt: z.date().transform((date) => date.toISOString()),
  requiresConfirmation: z.literal(true),
});

export type ConfirmationRequired = z.input<typeof confirmationRequiredSchema>;

export class ConfirmationRequiredDto extends createZodDto(
  confirmationRequiredSchema,
) {}
