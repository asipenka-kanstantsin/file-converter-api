import { config as loadDotenv } from 'dotenv';

import { type AppConfig, buildAppConfig } from './app-config';
import { envSchema } from './env.schema';

export class InvalidConfigError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`Invalid environment variables: ${variables.join(', ')}`);
    this.name = 'InvalidConfigError';
  }
}

export function parseAppConfig(raw: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const variables = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ].sort();
    throw new InvalidConfigError(variables);
  }
  return buildAppConfig(result.data);
}

// What a forked helper needs to start Node and load its native libraries — nothing of the app's
// own configuration. Everything outside this list (database URL, JWT secrets, S3 keys) stays in
// the API process.
const CHILD_ENV_KEYS = [
  'COMSPEC',
  'HOME',
  'LANG',
  'LC_ALL',
  'LD_LIBRARY_PATH',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'windir',
] as const;

// A child process that parses hostile input (the SVG renderer, decision F11) is started with this
// instead of inheriting the API's environment: a bug in librsvg must not expose the secrets.
export function childProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

// The only functions in the codebase that read process.env. Variables already set by the
// platform win over the file (dotenv never overrides).
export function loadAppConfig(): AppConfig {
  const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  loadDotenv({ path: file, quiet: true });
  return parseAppConfig(process.env);
}
