import { InvalidConfigError, parseAppConfig } from './load-app-config';

const validEnv = {
  APP_CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  NODE_ENV: 'production',
};

describe('parseAppConfig', () => {
  it('builds a typed, frozen config with defaults', () => {
    const config = parseAppConfig(validEnv);

    expect(config.app).toEqual({
      corsOrigins: ['https://app.example.com', 'https://admin.example.com'],
      jsonBodyLimit: '1mb',
      port: 3001,
      trustProxy: 0,
    });
    expect(config.log).toEqual({ level: 'info', pretty: false });
    expect(config.throttle).toEqual({ limit: 100, ttlSeconds: 60 });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.app.corsOrigins)).toBe(true);
  });

  it('parses boolean strings explicitly', () => {
    expect(parseAppConfig({ ...validEnv, LOG_PRETTY: 'true' }).log.pretty).toBe(
      true,
    );
    expect(
      parseAppConfig({ ...validEnv, LOG_PRETTY: 'false' }).log.pretty,
    ).toBe(false);
  });

  it('lists every invalid variable by name and never its value', () => {
    const run = (): unknown =>
      parseAppConfig({
        ...validEnv,
        APP_CORS_ORIGINS: 'not-a-url',
        APP_PORT: '70000',
        DATABASE_URL: 'secret-but-invalid',
        NODE_ENV: 'development',
      });

    expect(run).toThrow(InvalidConfigError);
    try {
      run();
    } catch (error: unknown) {
      const configError = error as InvalidConfigError;
      expect(configError.variables).toEqual([
        'APP_CORS_ORIGINS',
        'APP_PORT',
        'DATABASE_URL',
      ]);
      expect(configError.message).not.toContain('secret-but-invalid');
    }
  });

  it.each([
    'http://app.example.com',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
  ])('refuses the CORS origin %p in production', (origin) => {
    expect(() =>
      parseAppConfig({ ...validEnv, APP_CORS_ORIGINS: origin }),
    ).toThrow(/APP_CORS_ORIGINS/);
  });

  it('allows local http origins outside production', () => {
    expect(
      parseAppConfig({
        ...validEnv,
        APP_CORS_ORIGINS: 'http://localhost:3000',
        NODE_ENV: 'development',
      }).app.corsOrigins,
    ).toEqual(['http://localhost:3000']);
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;

    expect(() => parseAppConfig(rest)).toThrow(/DATABASE_URL/);
  });
});
