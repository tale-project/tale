import { describe, expect, it } from 'vitest';

import { browserEnvironment } from './environment.ts';

describe('browserEnvironment', () => {
  it('keeps what a browser and the settings of the app need', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/app',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      TMPDIR: '/tmp',
      DISPLAY: ':99',
      XDG_RUNTIME_DIR: '/run/user/1000',
      CAMOUFOX_INSTALL_DIR: '/data/camoufox',
      DEBUG: 'session-manager',
      MOZ_LOG: 'timestamp',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      HTTPS_PROXY: 'http://proxy.corp:3128',
    };
    expect(browserEnvironment(env)).toEqual(env);
  });

  it.each([
    'GITHUB_TOKEN',
    'NPM_TOKEN',
    'UMAMI_PROXY_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'CLIENT_SECRET',
    'DB_PASSWORD',
    'DATABASE_PASSWD',
    'OPENAI_API_KEY',
    'SSH_PRIVATE_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'github_token',
    'Api_Key',
  ])(
    'leaves out %s: it is nothing a web browser needs and a page could be after it',
    (name) => {
      expect(browserEnvironment({ [name]: 'value', PATH: '/bin' })).toEqual({
        PATH: '/bin',
      });
    },
  );

  it('leaves out variables that are not set', () => {
    expect(browserEnvironment({ PATH: '/bin', EMPTY: undefined })).toEqual({
      PATH: '/bin',
    });
  });

  it('does not change the environment it is given', () => {
    const env = { PATH: '/bin', GITHUB_TOKEN: 'x' };
    browserEnvironment(env);
    expect(env).toEqual({ PATH: '/bin', GITHUB_TOKEN: 'x' });
  });
});
