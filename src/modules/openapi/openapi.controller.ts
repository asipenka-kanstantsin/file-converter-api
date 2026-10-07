import { Controller, Get, Header, Inject } from '@nestjs/common';

import { Public } from '@/common/decorators';

import { DOCS_PAGE_CSP, DOCS_PAGE_HTML } from './docs-page';
import type { OpenApiDocument } from './openapi-document';
import { OPENAPI_DOCUMENT } from './openapi.constants';

@Public()
@Controller()
export class OpenApiController {
  constructor(
    @Inject(OPENAPI_DOCUMENT) private readonly document: OpenApiDocument,
  ) {}

  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', DOCS_PAGE_CSP)
  docs(): string {
    return DOCS_PAGE_HTML;
  }

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
