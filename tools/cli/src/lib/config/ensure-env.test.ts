import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateAgeKeypair } from '../crypto/age-keygen';
import {
  deriveDomainTls,
  ensureEnv,
  isLocalHostname,
  validateAdditionalSiteUrls,
} from './ensure-env';

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

describe('validateAdditionalSiteUrls', () => {
  test('unset or empty is fine — the single-domain default', () => {
    expect(
      validateAdditionalSiteUrls({
        additionalSiteUrls: undefined,
        tlsMode: 'letsencrypt',
      }),
    ).toEqual([]);
    expect(
      validateAdditionalSiteUrls({
        additionalSiteUrls: '   ',
        tlsMode: 'letsencrypt',
      }),
    ).toEqual([]);
  });

  test('public domains under letsencrypt → no issues', () => {
    expect(
      validateAdditionalSiteUrls({
        additionalSiteUrls: 'https://a.example.com, https://b.example.com',
        tlsMode: 'letsencrypt',
      }),
    ).toEqual([]);
  });

  test('a malformed entry blocks — the backend would refuse to boot on it', () => {
    const issues = validateAdditionalSiteUrls({
      additionalSiteUrls: 'https://ok.example, not-a-url',
      tlsMode: 'selfsigned',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('not-a-url');
  });

  test('a subpath entry blocks (an origin, not a URL with a path)', () => {
    const issues = validateAdditionalSiteUrls({
      additionalSiteUrls: 'https://ok.example/app',
      tlsMode: 'selfsigned',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('BASE_PATH');
  });

  test('letsencrypt + a local additional hostname blocks (ACME cannot issue)', () => {
    const issues = validateAdditionalSiteUrls({
      additionalSiteUrls: 'https://tale.local',
      tlsMode: 'letsencrypt',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('tale.local');
  });

  test('the same local hostname is fine when TLS is not letsencrypt', () => {
    expect(
      validateAdditionalSiteUrls({
        additionalSiteUrls: 'https://tale.local',
        tlsMode: 'selfsigned',
      }),
    ).toEqual([]);
    expect(
      validateAdditionalSiteUrls({
        additionalSiteUrls: 'https://tale.local',
        tlsMode: 'external',
      }),
    ).toEqual([]);
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

describe('ensureEnv — fresh defaults and the audit pepper', () => {
  test('a fresh .env points the backend at the in-compose sandbox spawner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-sandbox-url-'));
    try {
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      expect(env).toMatch(/^SANDBOX_URL=http:\/\/sandbox:8003$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a fresh .env includes a 64-hex TALE_AUDIT_PEPPER', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-fresh-'));
    try {
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      // >= 16 chars is what pii_hash.ts requires before it hashes instead of
      // writing plaintext email + IP; 32 bytes hex-encoded = 64 chars.
      expect(env).toMatch(/^TALE_AUDIT_PEPPER=[0-9a-f]{64}$/m);
      // The retired checkpoint-signing key is no longer written.
      expect(env).not.toContain('TALE_AUDIT_SIGNING_KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('headless fill appends the key when an existing .env lacks it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-fill-'));
    try {
      // A valid age key so the post-fill deriveAgePublicKey() succeeds; every
      // required var present EXCEPT TALE_AUDIT_PEPPER.
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
      expect(res.regeneratedAutoSecrets).toContain('TALE_AUDIT_PEPPER');
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      expect(env).toMatch(/^TALE_AUDIT_PEPPER=[0-9a-f]{64}$/m);
      // Existing secrets are preserved, not regenerated.
      expect(env).toContain('BETTER_AUTH_SECRET=existing-better-auth');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ensureEnv — the retired model gateway', () => {
  /** Every variable a deploy needs, but the audit pepper, and `extra`. */
  const existingEnv = (extra: string[]): string => {
    const age = generateAgeKeypair();
    return [
      'HOST=demo.tale.dev',
      'SITE_URL=https://demo.tale.dev',
      'TLS_MODE=letsencrypt',
      'BETTER_AUTH_SECRET=existing-better-auth',
      'ENCRYPTION_SECRET_HEX=existing-encryption',
      'INSTANCE_SECRET=existing-instance',
      'DB_PASSWORD=existing-password',
      `SOPS_AGE_KEY=${age.secretKey}`,
      'SANDBOX_TOKEN=existing-sandbox',
      'OBJECT_STORE_SECRET_KEY=existing-object-store',
      'TALE_CONTROL_TOKEN=existing-control',
      ...extra,
      '',
    ].join('\n');
  };

  // The model relay in the backend replaced the gateway
  // (tale-project/tale#4942), so a new workspace has none to sign in to.
  test('a fresh workspace gets no gateway admin credentials', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-gateway-'));
    try {
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      expect(env).not.toContain('SANDBOX_LLM_GATEWAY_');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A deployment that ran the gateway keeps its password: the backend reads
  // the spend of the keys the gateway minted, and revokes them, for as long
  // as a deploy keeps the gateway running.
  test('an existing gateway admin password stays as it is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-gateway-kept-'));
    try {
      writeFileSync(
        join(dir, '.env'),
        existingEnv([
          'SANDBOX_LLM_GATEWAY_ADMIN_USERNAME=admin',
          'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=kept-gateway-secret',
        ]),
        'utf-8',
      );
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      expect(res.regeneratedAutoSecrets).toEqual(['TALE_AUDIT_PEPPER']);
      const env = readFileSync(join(dir, '.env'), 'utf-8');
      expect(
        env.match(/^SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=.*$/gm) ?? [],
      ).toEqual(['SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=kept-gateway-secret']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a workspace without a gateway password is not given one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-gateway-none-'));
    try {
      writeFileSync(join(dir, '.env'), existingEnv([]), 'utf-8');
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      expect(res.regeneratedAutoSecrets).toEqual(['TALE_AUDIT_PEPPER']);
      expect(readFileSync(join(dir, '.env'), 'utf-8')).not.toContain(
        'SANDBOX_LLM_GATEWAY_',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The control door (/api/control) exists only where the backend has its
// bearer: the deploy's drain and its check before it retires the model
// gateway, the reseed and owner recovery all call it.
describe('ensureEnv — the control token', () => {
  test('a fresh .env carries a 64-hex TALE_CONTROL_TOKEN', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-control-'));
    try {
      const res = await ensureEnv({ deployDir: dir });
      expect(res.success).toBe(true);
      expect(readFileSync(join(dir, '.env'), 'utf-8')).toMatch(
        /^TALE_CONTROL_TOKEN=[0-9a-f]{64}$/m,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a deployment from before it gets one on its next deploy, and keeps it after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-control-topup-'));
    try {
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
          'TALE_AUDIT_PEPPER=existing-pepper',
          'OBJECT_STORE_SECRET_KEY=existing-object-store',
          '',
        ].join('\n'),
        'utf-8',
      );
      const first = await ensureEnv({ deployDir: dir });
      expect(first.regeneratedAutoSecrets).toEqual(['TALE_CONTROL_TOKEN']);
      const token = /^TALE_CONTROL_TOKEN=([0-9a-f]{64})$/m.exec(
        readFileSync(join(dir, '.env'), 'utf-8'),
      )?.[1];
      expect(token).toBeDefined();
      const again = await ensureEnv({ deployDir: dir });
      expect(again.regeneratedAutoSecrets ?? []).toEqual([]);
      expect(readFileSync(join(dir, '.env'), 'utf-8')).toContain(
        `TALE_CONTROL_TOKEN=${token}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ensureEnv — a dry run writes nothing', () => {
  test('no .env yet: the run succeeds and none is created', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-dry-fresh-'));
    try {
      const res = await ensureEnv({ deployDir: dir, dryRun: true });
      expect(res.success).toBe(true);
      expect(existsSync(join(dir, '.env'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing secret leaves .env as it is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-env-dry-fill-'));
    try {
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
          'OBJECT_STORE_SECRET_KEY=existing-object-store',
          'TALE_CONTROL_TOKEN=existing-control',
          '',
        ].join('\n'),
        'utf-8',
      );
      const before = readFileSync(join(dir, '.env'), 'utf-8');
      const res = await ensureEnv({ deployDir: dir, dryRun: true });
      // The same result a real run returns, so the deploy preview plans the
      // same recreation.
      expect(res).toEqual({
        success: true,
        agePublicKey: age.publicKey,
        regeneratedAutoSecrets: ['TALE_AUDIT_PEPPER'],
      });
      expect(readFileSync(join(dir, '.env'), 'utf-8')).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
