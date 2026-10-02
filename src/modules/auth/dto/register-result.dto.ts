import { z } from 'zod';

import { userEnvelopeSchema } from '@/modules/users';

import { confirmationRequiredSchema } from './confirmation-required.dto';

// A union cannot be a DTO class; the serializer takes the schema itself.
export const registerResultSchema = z.union([
  userEnvelopeSchema,
  confirmationRequiredSchema,
]);
