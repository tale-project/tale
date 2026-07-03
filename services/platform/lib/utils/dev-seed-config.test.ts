import { describe, expect, it } from 'vitest';

import {
  DEV_SEED_DEFAULT_EMAIL,
  DEV_SEED_DEFAULT_PASSWORD,
  resolveDevSeedConfig,
} from './dev-seed-config';

describe('resolveDevSeedConfig', () => {
  it('enables with the default identity when the flag is on and SITE_URL is loopback', () => {
    const config = resolveDevSeedConfig({
      TALE_DEV_SEED_USER: '1',
      SITE_URL: 'https://localhost',
    });
    expect(config).toEqual({
      enabled: true,
      email: DEV_SEED_DEFAULT_EMAIL,
      password: DEV_SEED_DEFAULT_PASSWORD,
      usesDefaultPassword: true,
    });
  });

  it('falls back to the loopback default when SITE_URL is unset', () => {
    const config = resolveDevSeedConfig({ TALE_DEV_SEED_USER: '1' });
    expect(config.enabled).toBe(true);
  });

  it('normalizes a custom identity and flags the non-default password', () => {
    const config = resolveDevSeedConfig({
      TALE_DEV_SEED_USER: 'true',
      SITE_URL: 'https://127.0.0.1',
      TALE_DEV_SEED_USER_EMAIL: '  Admin@Tale.TEST ',
      TALE_DEV_SEED_USER_PASSWORD: 'Custom!Passw0rd',
    });
    expect(config).toEqual({
      enabled: true,
      email: 'admin@tale.test',
      password: 'Custom!Passw0rd',
      usesDefaultPassword: false,
    });
  });

  it.each(['', '0', 'false', 'no', 'off', 'OFF', 'False'])(
    'stays disabled for opt-out flag value %j',
    (flag) => {
      const config = resolveDevSeedConfig({
        TALE_DEV_SEED_USER: flag,
        SITE_URL: 'https://localhost',
      });
      expect(config).toMatchObject({ enabled: false });
    },
  );

  it('stays disabled when the flag is absent entirely', () => {
    const config = resolveDevSeedConfig({ SITE_URL: 'https://localhost' });
    expect(config).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('TALE_DEV_SEED_USER') as string,
    });
  });

  it('refuses a non-loopback SITE_URL even with the flag on', () => {
    const config = resolveDevSeedConfig({
      TALE_DEV_SEED_USER: '1',
      SITE_URL: 'https://tale.example.com',
    });
    expect(config).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('loopback') as string,
    });
  });

  it('refuses an unparseable SITE_URL instead of guessing', () => {
    const config = resolveDevSeedConfig({
      TALE_DEV_SEED_USER: '1',
      SITE_URL: 'not a url',
    });
    expect(config).toMatchObject({ enabled: false });
  });
});
