import { z } from 'zod';

import { userEnvelopeSchema } from '@/modules/users';

import { confirmationRequiredSchema } from './confirmation-required.dto';

// Register and login answer either the user (201/200) or a pending confirmation (202). A union
// cannot be a DTO class; the serializer takes the schema itself.
export const userOrConfirmationSchema = z.union([
  userEnvelopeSchema,
  confirmationRequiredSchema,
]);
