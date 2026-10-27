import { InvalidConfigError, parseAppConfig } from './load-app-config';

const validEnv = {
  APP_CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
  APP_PUBLIC_URL: 'https://api.example.com/',
  APP_TRUST_PROXY: '1',
  AUTH_JWT_ACCESS_SECRET: 'a'.repeat(32),
  AUTH_JWT_REFRESH_SECRET: 'r'.repeat(32),
  AUTH_OTP_PEPPER: 'p'.repeat(32),
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  MAIL_FROM: 'File Converter <no-reply@example.com>',
  NODE_ENV: 'production',
  SMTP_HOST: 'pro.turbo-smtp.com',
  SMTP_PASS: 'smtp-pass',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
};

describe('parseAppConfig', () => {
  it('builds a typed, frozen config with defaults', () => {
    const config = parseAppConfig(validEnv);

    expect(config.app).toEqual({
      corsOrigins: ['https://app.example.com', 'https://admin.example.com'],
      jsonBodyLimit: '1mb',
      port: 3001,
      publicUrl: 'https://api.example.com',
      trustProxy: 1,
    });
    expect(config.confirmation).toEqual({
      maxAttempts: 5,
      maxResends: 3,
      resendCooldownSeconds: 60,
      ttlSeconds: 600,
    });
    expect(config.mail.smtp).toEqual({
      host: 'pro.turbo-smtp.com',
      pass: 'smtp-pass',
      port: 587,
      secure: false,
      user: 'smtp-user',
    });
    expect(config.log).toEqual({ level: 'info', pretty: false });
    expect(config.throttle).toEqual({
      confirmLimit: 10,
      convertLimit: 30,
      limit: 100,
      loginBlockSeconds: 900,
      loginLimit: 5,
      loginWindowSeconds: 900,
      mailLimit: 3,
      profileLimit: 60,
      ttlSeconds: 60,
      uploadLimit: 10,
    });
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

  it('refuses identical access and refresh secrets in production', () => {
    expect(() =>
      parseAppConfig({ ...validEnv, AUTH_JWT_REFRESH_SECRET: 'a'.repeat(32) }),
    ).toThrow(/AUTH_JWT_REFRESH_SECRET/);
  });

  it('refuses an OTP pepper that repeats a signing secret in production', () => {
    expect(() =>
      parseAppConfig({ ...validEnv, AUTH_OTP_PEPPER: 'r'.repeat(32) }),
    ).toThrow(/AUTH_OTP_PEPPER/);
  });

  it.each([
    'AUTH_JWT_ACCESS_SECRET',
    'AUTH_JWT_REFRESH_SECRET',
    'AUTH_OTP_PEPPER',
  ])('refuses the placeholder %s shipped in .env.example', (key) => {
    expect(() =>
      parseAppConfig({
        ...validEnv,
        [key]: 'change-me-32-chars-minimum-xxxxxxxxxxxx',
      }),
    ).toThrow(new RegExp(key));
  });

  it('requires an explicit APP_TRUST_PROXY in production only', () => {
    const { APP_TRUST_PROXY: _omitted, ...rest } = validEnv;

    expect(() => parseAppConfig(rest)).toThrow(/APP_TRUST_PROXY/);
    expect(
      parseAppConfig({ ...rest, NODE_ENV: 'development' }).app.trustProxy,
    ).toBe(0);
  });

  it('requires secure cookies and SMTP credentials in production', () => {
    expect(() =>
      parseAppConfig({ ...validEnv, AUTH_COOKIE_SECURE: 'false' }),
    ).toThrow(/AUTH_COOKIE_SECURE/);
    expect(() => parseAppConfig({ ...validEnv, SMTP_PASS: '' })).toThrow(
      /SMTP_USER/,
    );
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;

    expect(() => parseAppConfig(rest)).toThrow(/DATABASE_URL/);
  });
});
