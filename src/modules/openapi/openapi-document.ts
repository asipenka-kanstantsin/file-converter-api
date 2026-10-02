import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

// src/modules/openapi → repository root, the same depth under dist/.
export const OPENAPI_SPEC_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'openapi',
  'openapi.yaml',
);

export interface OpenApiDocument {
  json: string;
  yaml: string;
}

export function loadOpenApiDocument(path = OPENAPI_SPEC_PATH): OpenApiDocument {
  const yaml = readFileSync(path, 'utf8');
  const parsed: unknown = parse(yaml);
  return { json: JSON.stringify(parsed), yaml };
}
