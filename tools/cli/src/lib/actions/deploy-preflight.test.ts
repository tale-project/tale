import { describe, expect, test } from 'bun:test';

import { validateTlsPrereqs } from './deploy-preflight';

describe('validateTlsPrereqs', () => {
  test('selfsigned is always fine', () => {
    expect(
      validateTlsPrereqs({
        tlsMode: 'selfsigned',
        host: 'localhost',
        tlsEmail: '',
      }),
    ).toEqual([]);
  });

  test('undefined mode is fine', () => {
    expect(
      validateTlsPrereqs({
        tlsMode: undefined,
        host: undefined,
        tlsEmail: undefined,
      }),
    ).toEqual([]);
  });

  test('letsencrypt + public domain + email → no issues', () => {
    expect(
      validateTlsPrereqs({
        tlsMode: 'letsencrypt',
        host: 'demo.tale.dev',
        tlsEmail: 'ops@tale.dev',
      }),
    ).toEqual([]);
  });

  test('letsencrypt + localhost → blocks (cannot issue)', () => {
    const issues = validateTlsPrereqs({
      tlsMode: 'letsencrypt',
      host: 'localhost',
      tlsEmail: 'ops@tale.dev',
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('public domain');
  });

  test('letsencrypt + missing email → blocks', () => {
    const issues = validateTlsPrereqs({
      tlsMode: 'letsencrypt',
      host: 'demo.tale.dev',
      tlsEmail: undefined,
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('TLS_EMAIL');
  });

  test('letsencrypt + local host + missing email → two issues', () => {
    const issues = validateTlsPrereqs({
      tlsMode: 'letsencrypt',
      host: '127.0.0.1',
      tlsEmail: '',
    });
    expect(issues.length).toBe(2);
  });
});
