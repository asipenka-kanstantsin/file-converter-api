import { Module } from '@nestjs/common';

import { loadOpenApiDocument } from './openapi-document';
import { OPENAPI_DOCUMENT } from './openapi.constants';
import { OpenApiController } from './openapi.controller';

@Module({
  controllers: [OpenApiController],
  providers: [
    { provide: OPENAPI_DOCUMENT, useFactory: () => loadOpenApiDocument() },
  ],
})
export class OpenApiModule {}
