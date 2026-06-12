import { describe, expect, test } from 'bun:test';

import { deriveDomainTls, isLocalHostname } from './ensure-env';

describe('isLocalHostname', () => {
  test.each([
    ['localhost', true],
    ['LocalHost', true],
    ['app.local', true],
    ['foo.localhost', true],
    ['127.0.0.1', true],
    ['10.0.0.5', true],
    ['::1', true],
    ['', true],
    ['demo.tale.dev', false],
    ['example.com', false],
  ])('%s → %p', (host, expected) => {
    expect(isLocalHostname(host)).toBe(expected);
  });
});

describe('deriveDomainTls', () => {
  test('trial → localhost + self-signed, no email', () => {
    expect(deriveDomainTls({ mode: 'trial' })).toEqual({
      mode: 'trial',
      host: 'localhost',
      siteUrl: 'https://localhost',
      tlsMode: 'selfsigned',
      tlsEmail: '',
    });
  });

  test('production + public domain → letsencrypt with email', () => {
    expect(
      deriveDomainTls({
        mode: 'production',
        host: 'demo.tale.dev',
        email: 'ops@tale.dev',
      }),
    ).toEqual({
      mode: 'production',
      host: 'demo.tale.dev',
      siteUrl: 'https://demo.tale.dev',
      tlsMode: 'letsencrypt',
      tlsEmail: 'ops@tale.dev',
    });
  });

  test('production + local host → downgraded to self-signed (footgun guard)', () => {
    const result = deriveDomainTls({ mode: 'production', host: 'localhost' });
    expect(result.tlsMode).toBe('selfsigned');
    expect(result.tlsEmail).toBe('');
    expect(result.host).toBe('localhost');
  });

  test('production + bare IP → downgraded to self-signed', () => {
    expect(
      deriveDomainTls({ mode: 'production', host: '192.168.1.10' }).tlsMode,
    ).toBe('selfsigned');
  });
});
