import { AppConfig, loadAppConfig } from '@/config';

// A copy of the test config with selected groups replaced — for e2e cases that need, e.g., a
// tiny rate limit or an unreachable database, without mocking the ORM.
export function testConfig(
  overrides: Partial<Pick<AppConfig, 'db' | 'throttle'>>,
): AppConfig {
  const base = loadAppConfig();
  return Object.freeze({
    app: base.app,
    db: overrides.db ?? base.db,
    log: base.log,
    throttle: overrides.throttle ?? base.throttle,
  });
}

export { AppConfig };
