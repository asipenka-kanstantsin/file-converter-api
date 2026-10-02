import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const confirmWithLinkQuerySchema = z.object({
  token: z.string().regex(/^[\w-]{43}$/),
});

export class ConfirmWithLinkQueryDto extends createZodDto(
  confirmWithLinkQuerySchema,
) {}
