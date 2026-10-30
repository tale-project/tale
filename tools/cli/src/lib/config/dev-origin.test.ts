import { describe, expect, test } from 'bun:test';

import { CliError, ExitCode } from '../../utils/fail';
import {
  deploySiteUrl,
  resolveDeployHost,
  resolveDevOrigin,
} from './dev-origin';

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

describe('tale deploy --host origin', () => {
  test.each([
    ['Tale.Example.com', 'tale.example.com'],
    ['203.0.113.7', '203.0.113.7'],
    ['[2001:db8::1]', '2001:db8::1'],
  ])('accepts %s as %s', (host, normalized) => {
    expect(resolveDeployHost(host)).toBe(normalized);
  });

  test.each([
    '',
    'https://tale.example.com',
    'tale.example.com:8443',
    'tale.example.com/app',
    '127.1',
  ])('refuses %s as a usage error with a deploy example', (host) => {
    let error: unknown;
    try {
      resolveDeployHost(host);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain('Invalid --host');
    expect((error as CliError).info.code).toBe(ExitCode.Usage);
  });

  test.each([
    ['tale.example.com', 'https://localhost', 'https://tale.example.com'],
    [
      'tale.example.com',
      'https://old.example.com:8443',
      'https://tale.example.com:8443',
    ],
    ['tale.example.com', 'http://old.example.com', 'http://tale.example.com'],
    ['tale.example.com', undefined, 'https://tale.example.com'],
    ['tale.example.com', 'not a url', 'https://tale.example.com'],
    ['tale.example.com', 'ftp://old.example.com', 'https://tale.example.com'],
    ['2001:db8::1', 'https://localhost:4443', 'https://[2001:db8::1]:4443'],
  ])(
    'serves %s with the scheme and port of SITE_URL %s',
    (host, siteUrl, expected) => {
      expect(deploySiteUrl(host, siteUrl)).toBe(expected);
    },
  );
});
