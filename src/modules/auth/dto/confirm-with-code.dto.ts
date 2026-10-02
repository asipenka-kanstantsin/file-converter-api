import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { uuidSchema } from '@/common/validation';

export const confirmWithCodeSchema = z.object({
  challengeId: uuidSchema,
  code: z.string().regex(/^\d{6}$/),
});

export class ConfirmWithCodeDto extends createZodDto(confirmWithCodeSchema) {}
