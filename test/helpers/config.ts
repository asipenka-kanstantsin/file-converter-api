import { AppConfig, loadAppConfig } from '@/config';

interface Overrides {
  conversion?: Partial<AppConfig['conversion']>;
  db?: AppConfig['db'];
  storage?: AppConfig['storage'];
  throttle?: Partial<AppConfig['throttle']>;
}

// A copy of the test config with selected values replaced, for e2e cases that need e.g. a tiny
// rate limit or an unreachable database without mocking the ORM.
export function testConfig(overrides: Overrides): AppConfig {
  const base = loadAppConfig();
  return Object.freeze({
    app: base.app,
    auth: base.auth,
    confirmation: base.confirmation,
    conversion: Object.freeze({ ...base.conversion, ...overrides.conversion }),
    db: overrides.db ?? base.db,
    jobs: base.jobs,
    log: base.log,
    mail: base.mail,
    storage: overrides.storage ?? base.storage,
    throttle: Object.freeze({ ...base.throttle, ...overrides.throttle }),
  });
}

export { AppConfig };
