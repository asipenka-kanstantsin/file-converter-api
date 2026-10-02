import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import addFormats from 'ajv-formats';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import type { Response } from 'supertest';
import { parse } from 'yaml';

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

interface HeaderObject {
  required?: boolean;
  schema?: unknown;
}

interface ResponseObject {
  content?: Record<string, { schema?: unknown }>;
  headers?: Record<string, HeaderObject | Ref>;
  'x-error-codes'?: string[];
}

interface Ref {
  $ref: string;
}

interface OperationObject {
  operationId?: string;
  responses: Record<string, Ref | ResponseObject>;
}

export interface OpenApiSpec {
  components?: Record<string, Record<string, unknown>>;
  paths: Record<string, Partial<Record<HttpMethod, OperationObject>>>;
}

const SPEC_ID = 'openapi.json';
// Every response carries it (see info.description), documented or not on the operation.
const ALWAYS_REQUIRED_HEADERS = ['x-request-id'];

export const spec = parse(
  readFileSync(join(__dirname, '..', '..', 'openapi', 'openapi.yaml'), 'utf8'),
) as OpenApiSpec;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(spec, SPEC_ID);

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isRef(value: unknown): value is Ref {
  return typeof value === 'object' && value !== null && '$ref' in value;
}

// Follows local `#/…` references until a non-reference object; returns it with its JSON
// pointer so nested schemas can be compiled by reference (Ajv resolves deeper $refs itself).
function resolve<T>(
  value: Ref | T,
  pointer: string[],
): { pointer: string[]; value: T } {
  let current: unknown = value;
  let path = pointer;
  for (let depth = 0; isRef(current); depth++) {
    if (depth > 10) throw new Error(`Contract: $ref loop at ${path.join('/')}`);
    path = current.$ref.replace(/^#\//, '').split('/');
    current = path.reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      spec,
    );
  }
  return { pointer: path, value: current as T };
}

function validator(pointer: string[]): ValidateFunction {
  const ref = `${SPEC_ID}#/${pointer.map(escapePointer).join('/')}`;
  return ajv.getSchema(ref) ?? ajv.compile({ $ref: ref });
}

function templateRegex(template: string): RegExp {
  const pattern = template
    .split('/')
    .map((part) =>
      /^\{.+\}$/.test(part)
        ? '[^/]+'
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`);
}

export function findPathTemplate(url: string): string | undefined {
  const path = url.split('?')[0] ?? url;
  const templates = Object.keys(spec.paths);
  return (
    templates.find((template) => template === path) ??
    templates.find((template) => templateRegex(template).test(path))
  );
}

function fail(label: string, message: string): never {
  throw new Error(`Contract: ${label} ${message}`);
}

function checkHeaders(
  label: string,
  response: ResponseObject,
  pointer: string[],
  res: Response,
): void {
  for (const name of ALWAYS_REQUIRED_HEADERS) {
    if (res.headers[name] === undefined)
      fail(label, `is missing header ${name}`);
  }
  for (const [name, declared] of Object.entries(response.headers ?? {})) {
    const header = resolve<HeaderObject>(declared, [
      ...pointer,
      'headers',
      name,
    ]);
    const raw: unknown = res.headers[name.toLowerCase()];
    // Set-Cookie arrives as an array: the header is valid when one of its values is.
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (value): value is string => typeof value === 'string',
    );
    if (values.length === 0) {
      if (header.value.required) fail(label, `is missing header ${name}`);
      continue;
    }
    if (header.value.schema === undefined) continue;
    const validate = validator([...header.pointer, 'schema']);
    // Ajv's validator is a type guard that would narrow values to never; use a plain boolean.
    const accepts = (data: unknown): boolean => validate(data);
    const valid = values.some((value) => {
      const numeric = Number(value);
      return (
        (value !== '' && Number.isFinite(numeric) && accepts(numeric)) ||
        accepts(value)
      );
    });
    if (!valid) {
      fail(
        label,
        `header ${name}=${values.join(' | ')} invalid: ${ajv.errorsText(validate.errors)}`,
      );
    }
  }
}

// Asserts that an HTTP response is exactly what openapi/openapi.yaml promises for this
// operation: a documented status (or `default`), the documented content type, a body matching
// the schema, required headers present and valid, an error code listed in x-error-codes.
export function expectContract(
  method: HttpMethod,
  url: string,
  res: Response,
): void {
  const template = findPathTemplate(url);
  if (!template) fail(url, 'matches no path in openapi.yaml');
  const operation = spec.paths[template]?.[method];
  const label = `${method.toUpperCase()} ${template}`;
  if (!operation) fail(label, 'is not documented');

  const status = String(res.status);
  const key = status in operation.responses ? status : 'default';
  const declared = operation.responses[key];
  if (!declared) {
    fail(
      label,
      `returned ${status}, documented: ${Object.keys(operation.responses).join(', ')}`,
    );
  }
  const { pointer, value: response } = resolve<ResponseObject>(declared, [
    'paths',
    template,
    method,
    'responses',
    key,
  ]);
  const where = `${label} ${status}`;

  if (res.status >= 400) {
    const code = String((res.body as { code?: unknown }).code);
    const codes = response['x-error-codes'];
    if (!codes?.includes(code)) {
      fail(
        where,
        `returned code ${code}, x-error-codes: ${codes?.join(', ') ?? 'none'}`,
      );
    }
  } else if (key === 'default') {
    fail(label, `returned undocumented success status ${status}`);
  }
  // `default` lists INTERNAL_ERROR so the spec is honest, but a 500 in a test is always a defect.
  if (res.status >= 500 && key === 'default') {
    fail(where, `unexpected server error: ${JSON.stringify(res.body)}`);
  }

  const contentType = (res.headers['content-type'] ?? '').split(';')[0] ?? '';
  const media = response.content?.[contentType];
  if (response.content && !media) {
    fail(
      where,
      `returned ${contentType || 'no content type'}, documented: ${Object.keys(response.content).join(', ')}`,
    );
  }
  if (media?.schema !== undefined && contentType.endsWith('json')) {
    const validate = validator([...pointer, 'content', contentType, 'schema']);
    if (!validate(res.body)) {
      fail(
        where,
        `body mismatch: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(res.body, null, 2)}`,
      );
    }
  }

  checkHeaders(where, response, pointer, res);
}

// For responses that belong to no operation (unknown paths): the shared envelope only.
export function expectErrorEnvelope(res: Response, code: string): void {
  const validate = validator(['components', 'schemas', 'ErrorEnvelope']);
  if (!validate(res.body)) {
    fail(
      `${res.status}`,
      `is not an ErrorEnvelope: ${ajv.errorsText(validate.errors)}`,
    );
  }
  if ((res.body as { code?: unknown }).code !== code) {
    fail(
      `${res.status}`,
      `code ${String((res.body as { code?: unknown }).code)}, expected ${code}`,
    );
  }
  for (const name of ALWAYS_REQUIRED_HEADERS) {
    if (res.headers[name] === undefined)
      fail(`${res.status}`, `is missing header ${name}`);
  }
}

export function documentedOperations(): string[] {
  return Object.entries(spec.paths).flatMap(([path, operations]) =>
    Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
  );
}
