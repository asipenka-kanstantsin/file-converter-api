import { z } from 'zod';

// multipart/form-data fields arrive as strings (Notion "Сохранение результатов" 1.3.1: `save`
// is a boolean or "true"/"false"; default false).
export const saveFlagSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const formatPairsSchema = z.array(
  z.object({ source: z.string(), target: z.array(z.string()) }),
);
