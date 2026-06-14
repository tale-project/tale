import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateAgeKeypair } from '../crypto/age-keygen';
import { deriveDomainTls, ensureEnv, isLocalHostname } from './ensure-env';

describe('isLocalHostname', () => {
  test.each([
    ['localhost', true],
    ['LocalHost', true],
    ['app.local', true],
    ['foo.localhost', true],
    ['127.0.0.1', true],
    ['10.0.0.5', true],
    ['::1', true],
    ['fe80::1', true],
    ['2001:db8::1', true],
    ['[::1]', true],
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

  test('production + bare IPv6 → downgraded to self-signed', () => {
    expect(
      deriveDomainTls({ mode: 'production', host: '2001:db8::1' }).tlsMode,
    ).toBe('selfsigned');
  });
});

describe('ensureEnv — audit signing key auto-gen', () => {
  test('a fresh .env includes a 64-hex TALE_AUDIT_SIGNING_KEY', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-fresh-'));
    try {
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      const match = env.match(/^TALE_AUDIT_SIGNING_KEY=([0-9a-f]+)$/m);
      expect(match).not.toBeNull();
      // 32 bytes hex-encoded = 64 chars; mirrors INSTANCE_SECRET shape.
      expect(match?.[1]).toHaveLength(64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('headless fill appends the key when an existing .env lacks it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-fill-'));
    try {
      // A valid age key so the post-fill deriveAgePublicKey() succeeds; every
      // required var present EXCEPT TALE_AUDIT_SIGNING_KEY (the new secret).
      const age = generateAgeKeypair();
      writeFileSync(
        join(dir, '.env'),
        [
          'HOST=demo.tale.dev',
          'SITE_URL=https://demo.tale.dev',
          'TLS_MODE=letsencrypt',
          'BETTER_AUTH_SECRET=existing-better-auth',
          'ENCRYPTION_SECRET_HEX=existing-encryption',
          'INSTANCE_SECRET=existing-instance',
          'DB_PASSWORD=existing-password',
          `SOPS_AGE_KEY=${age.secretKey}`,
          'SANDBOX_TOKEN=existing-sandbox',
          '',
        ].join('\n'),
        'utf-8',
      );
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      expect(res.regeneratedAutoSecrets).toContain('TALE_AUDIT_SIGNING_KEY');
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      expect(env).toMatch(/^TALE_AUDIT_SIGNING_KEY=[0-9a-f]{64}$/m);
      // Existing secrets are preserved, not regenerated.
      expect(env).toContain('BETTER_AUTH_SECRET=existing-better-auth');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
