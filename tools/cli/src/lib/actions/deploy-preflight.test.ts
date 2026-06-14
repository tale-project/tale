import { describe, expect, test } from 'bun:test';

import {
  checkProductionReadiness,
  validateTlsPrereqs,
} from './deploy-preflight';

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

describe('checkProductionReadiness (advisory, non-blocking)', () => {
  test('local trial host → no advisories (N/A)', () => {
    expect(
      checkProductionReadiness({
        HOST: 'localhost',
        DB_PASSWORD: 'tale_password_change_me',
      }),
    ).toEqual([]);
  });

  test('unset host → no advisories (N/A)', () => {
    expect(checkProductionReadiness({})).toEqual([]);
  });

  test('production host with placeholder DB password → advises', () => {
    const issues = checkProductionReadiness({
      HOST: 'demo.tale.dev',
      DB_PASSWORD: 'tale_password_change_me',
      TALE_AUDIT_SIGNING_KEY: 'set',
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('DB_PASSWORD');
  });

  test('production host with missing audit signing key → advises', () => {
    const issues = checkProductionReadiness({
      HOST: 'demo.tale.dev',
      DB_PASSWORD: 'a-strong-password',
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('TALE_AUDIT_SIGNING_KEY');
  });

  test('production host, both footguns → two advisories', () => {
    expect(
      checkProductionReadiness({
        HOST: 'demo.tale.dev',
        DB_PASSWORD: 'tale_password_change_me',
      }),
    ).toHaveLength(2);
  });

  test('production host, fully configured → no advisories', () => {
    expect(
      checkProductionReadiness({
        HOST: 'demo.tale.dev',
        DB_PASSWORD: 'a-strong-password',
        TALE_AUDIT_SIGNING_KEY: 'deadbeef',
      }),
    ).toEqual([]);
  });
});
