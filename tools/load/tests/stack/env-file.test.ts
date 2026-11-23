import { describe, expect, test } from 'bun:test';

import {
  apiEnv,
  parseEnvFile,
  relayPort,
  roleEnv,
} from '../../src/stack/stack.ts';

test('reads KEY=value lines, skips comments, unquotes, keeps = inside values', () => {
  const env = parseEnvFile(
    [
      '# a comment',
      '',
      'DATABASE_URL=postgres://u:p@h:5432/db?sslmode=disable',
      'export SITE_URL=http://127.0.0.1:4105',
      'QUOTED="two words"',
      "SINGLE='x=y'",
      '  INDENTED=yes',
      'not a line',
    ].join('\n'),
  );
  expect(env).toEqual({
    DATABASE_URL: 'postgres://u:p@h:5432/db?sslmode=disable',
    SITE_URL: 'http://127.0.0.1:4105',
    QUOTED: 'two words',
    SINGLE: 'x=y',
    INDENTED: 'yes',
  });
});

describe('roleEnv', () => {
  test('names the role in the variable the backend reads', () => {
    expect(roleEnv('api')).toEqual({ ROLE: 'api', TALE_ROLE: 'api' });
    expect(roleEnv('worker').ROLE).toBe('worker');
  });
});

describe('apiEnv', () => {
  test('starts each api process on its own port and without a web tier', () => {
    // Without APP_PORT=off every api process also served the app on the
    // default port 3000, and every one after the first failed its boot there.
    for (const [port, host, relay] of [
      [4105, '127.0.0.1', 8080],
      [4106, '0.0.0.0', 8081],
    ] as const) {
      expect(apiEnv(port, host, relay)).toEqual({
        ROLE: 'api',
        TALE_ROLE: 'api',
        PORT: String(port),
        BACKEND_LISTEN_HOST: host,
        APP_PORT: 'off',
        SANDBOX_RELAY_PORT: String(relay),
      });
    }
  });
});

describe('relayPort', () => {
  test('gives the first api process the env file relay port and each next one its own', () => {
    // Every api process serves the model relay; with one port for all, the
    // second api process failed its boot with EADDRINUSE on the first's.
    expect(relayPort({ SANDBOX_RELAY_PORT: '3008' }, 0)).toBe(3008);
    expect(relayPort({ SANDBOX_RELAY_PORT: '3008' }, 1)).toBe(3009);
    expect(relayPort({}, 0)).toBe(8080);
    expect(relayPort({}, 2)).toBe(8082);
  });

  test('refuses a relay port that is none or leaves no room', () => {
    expect(() => relayPort({ SANDBOX_RELAY_PORT: 'eighty' }, 0)).toThrow(
      'SANDBOX_RELAY_PORT must be a port',
    );
    expect(() => relayPort({ SANDBOX_RELAY_PORT: '65535' }, 1)).toThrow(
      'room for 2 api processes',
    );
  });
});
