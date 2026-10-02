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

// The only function in the codebase that reads process.env. Variables already set by the
// platform win over the file (dotenv never overrides).
export function loadAppConfig(): AppConfig {
  const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  loadDotenv({ path: file, quiet: true });
  return parseAppConfig(process.env);
}
