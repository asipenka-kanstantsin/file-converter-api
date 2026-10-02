import { type CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Every route needs a valid access token unless it opts out here (decision A19); applies to a
// controller or a single handler.
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
