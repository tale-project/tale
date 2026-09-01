import type { Sql } from 'postgres';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { encryptSecret } from '../../core/lib/secret_box.ts';
import {
  applyMicrosoftTenant,
  getCloudImportAppStatus,
  getOauthAppStatus,
  resolveCloudImportApp,
  resolveConnectorOauthApp,
} from './oauth-apps.ts';

/** A `sql` stand-in that answers every tagged-template query with `rows`.
 * Enough for the read-side resolvers, which issue one SELECT each. */
function fakeSql(rows: unknown[]): Sql {
  const tag = (..._args: unknown[]) => Promise.resolve(rows);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'google-drive',
    clientId: 'org-client-id',
    encryptedData: encryptSecret(
      JSON.stringify({ clientSecret: 'org-secret' }),
    ),
    config: null,
    maskedPreview: 'org-…et',
    updatedAtMs: 1000,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('applyMicrosoftTenant', () => {
  test('rewrites the /common tenant segment on Microsoft URLs', () => {
    expect(
      applyMicrosoftTenant(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'tenant-123',
      ),
    ).toBe(
      'https://login.microsoftonline.com/tenant-123/oauth2/v2.0/authorize',
    );
    expect(
      applyMicrosoftTenant(
        'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
        'tenant-123',
      ),
    ).toBe('https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token');
  });

  test('leaves non-Microsoft URLs and tenant-less calls alone', () => {
    const google = 'https://accounts.google.com/o/oauth2/v2/auth';
    expect(applyMicrosoftTenant(google, 'tenant-123')).toBe(google);
    const ms = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
    expect(applyMicrosoftTenant(ms, undefined)).toBe(ms);
    // Already tenant-pinned URLs are not double-rewritten.
    const pinned =
      'https://login.microsoftonline.com/existing-tenant/oauth2/v2.0/authorize';
    expect(applyMicrosoftTenant(pinned, 'tenant-123')).toBe(pinned);
  });
});

describe('resolveConnectorOauthApp', () => {
  test('an org row wins over the deployment env', async () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-secret');
    const resolved = await resolveConnectorOauthApp(
      fakeSql([orgRow()]),
      'org-1',
      'google-drive',
    );
    expect(resolved).toEqual({
      clientId: 'org-client-id',
      clientSecret: 'org-secret',
      source: 'org',
    });
  });

  test('falls back to CONNECTOR_OAUTH_<SLUG>_* with no org row', async () => {
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-secret');
    const resolved = await resolveConnectorOauthApp(
      fakeSql([]),
      'org-1',
      'google-drive',
    );
    expect(resolved).toEqual({
      clientId: 'env-client-id',
      clientSecret: 'env-secret',
      source: 'env',
    });
  });

  test('an unreadable org envelope falls through to env, never fails closed', async () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
    const row = orgRow();
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'a-different-key');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-secret');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolved = await resolveConnectorOauthApp(
      fakeSql([row]),
      'org-1',
      'google-drive',
    );
    expect(resolved?.source).toBe('env');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('nothing anywhere resolves to null', async () => {
    const resolved = await resolveConnectorOauthApp(
      fakeSql([]),
      'org-1',
      'google-drive',
    );
    expect(resolved).toBeNull();
  });

  test('the org row carries its Microsoft tenant', async () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
    const resolved = await resolveConnectorOauthApp(
      fakeSql([orgRow({ slug: 'outlook', config: { tenantId: 't-1' } })]),
      'org-1',
      'outlook',
    );
    expect(resolved?.tenantId).toBe('t-1');
  });
});

describe('resolveCloudImportApp', () => {
  test('onedrive keeps the Microsoft login-app env fallback chain', async () => {
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'login-app-id');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'login-app-secret');
    const resolved = await resolveCloudImportApp(
      fakeSql([]),
      'org-1',
      'onedrive',
    );
    expect(resolved).toEqual({
      clientId: 'login-app-id',
      clientSecret: 'login-app-secret',
      source: 'env',
    });
  });

  test('an org onedrive row beats every env fallback', async () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'login-app-id');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'login-app-secret');
    const resolved = await resolveCloudImportApp(
      fakeSql([orgRow({ slug: 'onedrive', config: { tenantId: 't-9' } })]),
      'org-1',
      'onedrive',
    );
    expect(resolved).toEqual({
      clientId: 'org-client-id',
      clientSecret: 'org-secret',
      tenantId: 't-9',
      source: 'org',
    });
  });
});

describe('getOauthAppStatus', () => {
  test('reports org, env, and none', async () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
    expect(
      await getOauthAppStatus(fakeSql([orgRow()]), 'org-1', 'google-drive'),
    ).toEqual({ configured: true, source: 'org' });

    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-secret');
    expect(
      await getOauthAppStatus(fakeSql([]), 'org-1', 'google-drive'),
    ).toEqual({ configured: true, source: 'env' });

    vi.unstubAllEnvs();
    expect(
      await getOauthAppStatus(fakeSql([]), 'org-1', 'google-drive'),
    ).toEqual({ configured: false, source: null });
  });

  test('the cloud-import status consults ITS env chain, not the connector one', async () => {
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'login-app-id');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'login-app-secret');
    expect(
      await getCloudImportAppStatus(fakeSql([]), 'org-1', 'onedrive'),
    ).toEqual({ configured: true, source: 'env' });
    // The connector-lane env name does NOT satisfy the cloud-import lane.
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-secret');
    expect(
      await getCloudImportAppStatus(fakeSql([]), 'org-1', 'google-drive'),
    ).toEqual({ configured: false, source: null });
  });
});
