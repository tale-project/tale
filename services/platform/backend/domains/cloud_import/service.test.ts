// @vitest-environment node

/**
 * The grant resolver's failure posture: only a DEAD grant (invalid_grant)
 * flips the row to needs-reauth; a vendor throttle/outage leaves it active
 * and reports a retryable error; an unreadable envelope (rotated
 * ENCRYPTION_SECRET_HEX) names its cause instead of being swallowed.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
} from '../../core/cloud_import/token_refresh.ts';
import { encryptSecret } from '../../core/lib/secret_box.ts';
import { resolveCloudImportApp } from '../connectors/oauth-apps.ts';
import { resolveCloudAccessToken } from './service.ts';

vi.mock('../../core/cloud_import/token_refresh.ts', () => ({
  refreshMicrosoftAccessToken: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
}));
vi.mock('../connectors/oauth-apps.ts', () => ({
  resolveCloudImportApp: vi.fn(),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(row: { encryptedData: unknown; status: string } | null): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('SELECT encrypted_data')) {
      return Promise.resolve(row ? [row] : []);
    }
    return Promise.resolve([]);
  };
  fn.json = (value: unknown) => value;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: fn as unknown as Sql, statements };
}

const needsReauthWrites = (statements: Statement[]): number =>
  statements.filter((s) => s.text.includes("status = 'needs-reauth'")).length;

const args = {
  organizationId: 'org-1',
  userId: 'user-1',
  provider: 'onedrive' as const,
};

function sealedGrant(expiresAt: number) {
  return encryptSecret(
    JSON.stringify({
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt,
      scopes: ['Files.Read'],
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
  vi.mocked(resolveCloudImportApp).mockResolvedValue({
    clientId: 'cid',
    clientSecret: 'sec',
    tenantId: 'tenant',
    source: 'env',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('resolveCloudAccessToken — refresh failures', () => {
  it('marks needs-reauth on a dead grant', async () => {
    vi.mocked(refreshMicrosoftAccessToken).mockResolvedValue({
      ok: false,
      kind: 'dead_grant',
      status: 400,
      detail: 'HTTP 400 invalid_grant',
    });
    const { sql, statements } = fakeSql({
      encryptedData: sealedGrant(Date.now() - 1000),
      status: 'active',
    });

    const result = await resolveCloudAccessToken(sql, args);

    expect(result).toMatchObject({ success: false, needsReauth: true });
    expect(needsReauthWrites(statements)).toBe(1);
  });

  it('leaves the grant active and reports a retryable error on a vendor outage', async () => {
    vi.mocked(refreshMicrosoftAccessToken).mockResolvedValue({
      ok: false,
      kind: 'unavailable',
      status: 503,
      detail: 'HTTP 503 server_error',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql, statements } = fakeSql({
      encryptedData: sealedGrant(Date.now() - 1000),
      status: 'active',
    });

    const result = await resolveCloudAccessToken(sql, args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.needsReauth).toBe(false);
      expect(result.error).toContain('HTTP 503');
    }
    expect(needsReauthWrites(statements)).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('token refresh unavailable'),
    );
  });

  it('stores the refreshed tokens on success (Google lane)', async () => {
    vi.mocked(refreshGoogleAccessToken).mockResolvedValue({
      ok: true,
      tokens: { accessToken: 'at-new', expiresAt: Date.now() + 3_600_000 },
    });
    const { sql, statements } = fakeSql({
      encryptedData: sealedGrant(Date.now() - 1000),
      status: 'active',
    });

    const result = await resolveCloudAccessToken(sql, {
      ...args,
      provider: 'google-drive',
    });

    expect(result).toEqual({ success: true, accessToken: 'at-new' });
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app.user_cloud_authorizations'),
      ),
    ).toBe(true);
    expect(needsReauthWrites(statements)).toBe(0);
  });
});

describe('resolveCloudAccessToken — unreadable envelope', () => {
  it('names a rotated ENCRYPTION_SECRET_HEX, logs the cause, and flags the row', async () => {
    const sealed = sealedGrant(Date.now() + 3_600_000);
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'a-different-key');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { sql, statements } = fakeSql({
      encryptedData: sealed,
      status: 'active',
    });

    const result = await resolveCloudAccessToken(sql, args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.needsReauth).toBe(true);
      expect(result.error).toContain('ENCRYPTION_SECRET_HEX');
    }
    expect(needsReauthWrites(statements)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('is unreadable'),
      expect.stringContaining('different ENCRYPTION_SECRET_HEX'),
    );
    expect(refreshMicrosoftAccessToken).not.toHaveBeenCalled();
  });

  it('reports a corrupt payload as undecryptable without claiming a key rotation', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { sql, statements } = fakeSql({
      encryptedData: encryptSecret('not json at all'),
      status: 'active',
    });

    const result = await resolveCloudAccessToken(sql, args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.needsReauth).toBe(true);
      expect(result.error).not.toContain('ENCRYPTION_SECRET_HEX');
    }
    expect(needsReauthWrites(statements)).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
