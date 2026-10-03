import { describe, expect, test } from 'bun:test';

import { resolveDevOrigin } from './dev-origin';

describe('local Tale origin', () => {
  test('local defaults have no redundant HTTPS port', () => {
    expect(resolveDevOrigin()).toEqual({
      host: 'localhost',
      port: 443,
      siteUrl: 'https://localhost',
    });
  });

  test.each([
    ['Tale.Localhost', 8443, 'tale.localhost', 'https://tale.localhost:8443'],
    ['127.0.0.1', 4443, '127.0.0.1', 'https://127.0.0.1:4443'],
    ['::1', 8443, '::1', 'https://[::1]:8443'],
    ['[::1]', 443, '::1', 'https://[::1]'],
  ])(
    'resolves %s:%i once for every local service',
    (host, port, normalized, siteUrl) => {
      expect(resolveDevOrigin(host, port)).toEqual({
        host: normalized,
        port,
        siteUrl,
      });
    },
  );

  test.each([
    '',
    'https://localhost',
    'localhost:8443',
    'localhost/path',
    'user@localhost',
    'localhost?x=1',
    'localhost#x',
    'local host',
    '-bad.localhost',
    'localhost\nother',
    '127.0.0.999',
    '[localhost]',
    '127.1',
    '12345',
  ])('refuses a host that is not a hostname or IP: %s', (host) => {
    expect(() => resolveDevOrigin(host)).toThrow('Invalid --host');
  });

  test.each([0, 65536, 1.2, Number.NaN, 8003])(
    'refuses invalid port %s',
    (port) => {
      expect(() => resolveDevOrigin('localhost', port)).toThrow(
        'Invalid --port',
      );
    },
  );
});
