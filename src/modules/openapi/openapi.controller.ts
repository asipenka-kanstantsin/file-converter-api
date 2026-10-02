import { Controller, Get, Header, Inject } from '@nestjs/common';

import type { OpenApiDocument } from './openapi-document';
import { OPENAPI_DOCUMENT } from './openapi.constants';

@Controller()
export class OpenApiController {
  constructor(
    @Inject(OPENAPI_DOCUMENT) private readonly document: OpenApiDocument,
  ) {}

  @Get('openapi.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  json(): string {
    return this.document.json;
  }

  @Get('openapi.yaml')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  yaml(): string {
    return this.document.yaml;
  }
}
