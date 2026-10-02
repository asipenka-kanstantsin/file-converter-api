import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const healthReportSchema = z.object({
  checks: z.object({ database: z.enum(['down', 'up']).optional() }),
  status: z.literal('ok'),
});

export type HealthReport = z.infer<typeof healthReportSchema>;

export class HealthReportDto extends createZodDto(healthReportSchema) {}
