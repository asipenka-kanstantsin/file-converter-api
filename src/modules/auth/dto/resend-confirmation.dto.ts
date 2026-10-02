import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { uuidSchema } from '@/common/validation';

export const resendConfirmationSchema = z.object({ challengeId: uuidSchema });

export class ResendConfirmationDto extends createZodDto(
  resendConfirmationSchema,
) {}
