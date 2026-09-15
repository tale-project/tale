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
      TALE_AUDIT_PEPPER: 'a-pepper-of-sixteen-chars',
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('DB_PASSWORD');
  });

  test('production host with missing audit signing key → advises', () => {
    const issues = checkProductionReadiness({
      HOST: 'demo.tale.dev',
      DB_PASSWORD: 'a-strong-password',
      TALE_AUDIT_PEPPER: 'a-pepper-of-sixteen-chars',
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('TALE_AUDIT_SIGNING_KEY');
  });

  test('production host with a missing or too-short audit pepper → advises', () => {
    const missing = checkProductionReadiness({
      HOST: 'demo.tale.dev',
      DB_PASSWORD: 'a-strong-password',
      TALE_AUDIT_SIGNING_KEY: 'set',
    });
    expect(missing.length).toBe(1);
    expect(missing[0].message).toContain('TALE_AUDIT_PEPPER');
    // pii_hash.ts ignores a pepper under 16 chars and falls back to
    // plaintext, so the advisory must fire for it too.
    const short = checkProductionReadiness({
      HOST: 'demo.tale.dev',
      DB_PASSWORD: 'a-strong-password',
      TALE_AUDIT_SIGNING_KEY: 'set',
      TALE_AUDIT_PEPPER: 'short',
    });
    expect(short.length).toBe(1);
    expect(short[0].message).toContain('TALE_AUDIT_PEPPER');
  });

  test('production host, every footgun → three advisories', () => {
    expect(
      checkProductionReadiness({
        HOST: 'demo.tale.dev',
        DB_PASSWORD: 'tale_password_change_me',
      }),
    ).toHaveLength(3);
  });

  test('production host, fully configured → no advisories', () => {
    expect(
      checkProductionReadiness({
        HOST: 'demo.tale.dev',
        DB_PASSWORD: 'a-strong-password',
        TALE_AUDIT_SIGNING_KEY: 'deadbeef',
        TALE_AUDIT_PEPPER: 'a-pepper-of-sixteen-chars',
      }),
    ).toEqual([]);
  });
});
