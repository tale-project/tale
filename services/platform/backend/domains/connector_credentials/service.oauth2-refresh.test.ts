/**
 * The oauth2 refresh seam. Access tokens die within the hour; a grant that
 * carries a refresh token is renewed BEFORE its material is handed out, the
 * renewed envelope replaces the stored one under a compare-and-swap, and a
 * grant the vendor no longer honours is marked `needs-reauth` so the settings
 * page shows Reconnect. Both resolvers — the direct decrypt seam and the 0.4
 * row answer the ctx shim serves — go through the same seam.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveConnectorOauthApp } = vi.hoisted(() => ({
  resolveConnectorOauthApp: vi.fn(),
}));
vi.mock('../connectors/oauth-apps.ts', () => ({
  resolveConnectorOauthApp,
  applyMicrosoftTenant: (url: string) => url,
}));

import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import {
  resolveConnectorCredential,
  resolveCredentialRowForShim,
} from './service.ts';

const HOUR = 3_600_000;
const APP = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  source: 'env',
};

interface Envelope {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

type Row = Record<string, unknown> & {
  encryptedData: EncryptedSecret;
  updatedAt: number;
};

function row(secret: Envelope, patch: Record<string, unknown> = {}): Row {
  return {
    id: 'cred_1',
    organizationId: 'org_1',
    connectorSlug: 'slack',
    authMethod: 'oauth2',
    name: 'Slack',
    encryptedData: encryptSecret(JSON.stringify(secret)),
    endpointUrl: null,
    config: null,
    maskedPreview: 'xo***',
    isDefault: true,
    mailSyncInboundSince: null,
    mailSyncOutboundSince: null,
    status: 'active',
    statusDetail: null,
    createdBy: 'user_1',
    createdAt: 1,
    updatedAt: 1000,
    ...patch,
  };
}

interface Update {
  text: string;
  values: unknown[];
}

interface Store {
  row: Row;
  /** When set, the next CAS write finds this row already stored instead. */
  casLostTo?: Row;
}

/**
 * A `sql` double over one credential row that behaves like the table: the
 * listing and the by-id re-read answer the stored row, and both CAS UPDATEs
 * (the needs-reauth flip and the re-sealed envelope) either write the row
 * or — when a concurrent write got there first — change nothing and return
 * no row. Every UPDATE is also captured for inspection.
 */
function fakeSql(store: Store): Sql & { updates: Update[] } {
  const updates: Update[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('UPDATE app.connector_credentials')) {
      updates.push({ text, values });
      if (text.includes("status = 'needs-reauth'")) {
        if (store.casLostTo !== undefined) {
          store.row = store.casLostTo;
          store.casLostTo = undefined;
          return Promise.resolve([]);
        }
        store.row = {
          ...store.row,
          status: 'needs-reauth',
          statusDetail: values[0],
          updatedAt: values[1] as number,
        };
        return Promise.resolve([{ id: store.row.id }]);
      }
      if (text.includes('RETURNING')) {
        if (store.casLostTo !== undefined) {
          store.row = store.casLostTo;
          store.casLostTo = undefined;
          return Promise.resolve([]);
        }
        store.row = {
          ...store.row,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seam wrote exactly this shape
          encryptedData: values[0] as EncryptedSecret,
          maskedPreview: values[1],
          updatedAt: values[2] as number,
        };
        return Promise.resolve([store.row]);
      }
      return Promise.resolve([]);
    }
    if (text.includes('FROM app.connector_credentials')) {
      return Promise.resolve([store.row]);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    updates,
  }) as unknown as Sql & { updates: Update[] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The stored envelope, opened. */
function envelopeOf(store: Store): Envelope {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seam sealed exactly this shape
  return JSON.parse(decryptSecret(store.row.encryptedData)) as Envelope;
}

const ARGS = { organizationId: 'org_1', connectorSlug: 'slack' };
const EXPIRED = {
  accessToken: 'dead-token',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() - 1,
};

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
  resolveConnectorOauthApp.mockReset();
  resolveConnectorOauthApp.mockResolvedValue(APP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resolveConnectorCredential — oauth2 refresh', () => {
  it('hands a live token out untouched: no vendor call, no write', async () => {
    const store: Store = {
      row: row({
        accessToken: 'live-token',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + HOUR,
      }),
    };
    const sql = fakeSql(store);
    const fetchImpl = vi.fn();
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    });
    expect(resolved.authHeader).toBe('Bearer live-token');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sql.updates).toEqual([]);
  });

  it('renews an expired token from the refresh token and re-seals the row under a CAS', async () => {
    const store: Store = { row: row({ ...EXPIRED, scopes: ['chat:write'] }) };
    const sql = fakeSql(store);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }),
      );

    const before = Date.now();
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    });

    expect(resolved.authHeader).toBe('Bearer fresh-token');
    expect(resolved.secrets).toMatchObject({
      accessToken: 'fresh-token',
      refreshToken: 'refresh-1',
    });
    // The vendor was asked with the refresh grant and the org's app.
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://slack.com/api/oauth.v2.access');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
    expect(resolveConnectorOauthApp).toHaveBeenCalledWith(
      sql,
      'org_1',
      'slack',
    );
    // One write: the renewed envelope, guarded by the row's updated_at_ms,
    // and nothing about the row's status.
    expect(sql.updates).toHaveLength(1);
    const [update] = sql.updates;
    expect(update.text).toContain('RETURNING');
    expect(update.text).toContain('AND updated_at_ms = ?');
    expect(update.values).toContain(1000);
    expect(update.text).not.toContain('status');
    const next = envelopeOf(store);
    expect(next.accessToken).toBe('fresh-token');
    // The vendor omitted the refresh token and the scopes: the grant's stay.
    expect(next.refreshToken).toBe('refresh-1');
    expect(next.scopes).toEqual(['chat:write']);
    expect(next.expiresAt).toBeGreaterThanOrEqual(before + HOUR);
    expect(store.row.status).toBe('active');
  });

  it('refreshes a token expiring within the skew, and keeps a rotated refresh token', async () => {
    const store: Store = {
      row: row({
        accessToken: 'nearly-dead',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 30_000,
      }),
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'fresh-token',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      }),
    );
    const resolved = await resolveConnectorCredential(fakeSql(store), ARGS, {
      fetchImpl,
    });
    expect(resolved.authHeader).toBe('Bearer fresh-token');
    expect(envelopeOf(store).refreshToken).toBe('refresh-2');
  });

  it('marks a grant with no refresh token needs-reauth and refuses, without a vendor call', async () => {
    const store: Store = {
      row: row({ accessToken: 'dead-token', expiresAt: Date.now() - 1 }),
    };
    const sql = fakeSql(store);
    const fetchImpl = vi.fn();
    const attempt = resolveConnectorCredential(sql, ARGS, { fetchImpl });
    await expect(attempt).rejects.toMatchObject({
      code: 'CREDENTIAL_NEEDS_REAUTH',
    });
    await expect(attempt).rejects.toThrow(/no refresh token/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sql.updates).toHaveLength(1);
    expect(store.row).toMatchObject({
      status: 'needs-reauth',
      statusDetail: expect.stringContaining('no refresh token'),
    });
  });

  it('marks a vendor-rejected refresh needs-reauth with the vendor code and refuses', async () => {
    const store: Store = { row: row({ ...EXPIRED, refreshToken: 'revoked' }) };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    const attempt = resolveConnectorCredential(fakeSql(store), ARGS, {
      fetchImpl,
    });
    await expect(attempt).rejects.toMatchObject({
      code: 'CREDENTIAL_NEEDS_REAUTH',
    });
    await expect(attempt).rejects.toThrow(/invalid_grant/);
    expect(store.row).toMatchObject({
      status: 'needs-reauth',
      statusDetail: 'the vendor rejected the token refresh: invalid_grant',
    });
    // The dead token is not re-sealed as if it were live.
    expect(envelopeOf(store).accessToken).toBe('dead-token');
  });

  it('does not flip a grant an operator re-issued between the read and the vendor rejection', async () => {
    // Reconnect stored a fresh envelope after this invocation read the row
    // and before the vendor rejected the old refresh token: the verdict is
    // about a stale envelope, so the needs-reauth write must lose its CAS
    // and the fresh grant is what gets handed out.
    const store: Store = {
      row: row({ ...EXPIRED, refreshToken: 'revoked' }),
      casLostTo: row(
        {
          accessToken: 'reconnected-token',
          refreshToken: 'refresh-9',
          expiresAt: Date.now() + HOUR,
        },
        { updatedAt: 2000 },
      ),
    };
    const sql = fakeSql(store);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    });
    expect(resolved.authHeader).toBe('Bearer reconnected-token');
    expect(store.row.status).toBe('active');
    expect(envelopeOf(store).accessToken).toBe('reconnected-token');
    // One attempted write, guarded by the updated_at_ms that was read.
    expect(sql.updates).toHaveLength(1);
    const [update] = sql.updates;
    expect(update.text).toContain("status = 'needs-reauth'");
    expect(update.text).toContain('AND updated_at_ms = ?');
    expect(update.values).toContain(1000);
  });

  it("refuses with the winner's verdict when a concurrent refresh already marked the row", async () => {
    const store: Store = {
      row: row({ ...EXPIRED, refreshToken: 'revoked' }),
      casLostTo: row(
        { ...EXPIRED, refreshToken: 'revoked' },
        {
          status: 'needs-reauth',
          statusDetail: 'the vendor rejected the token refresh: invalid_grant',
          updatedAt: 2000,
        },
      ),
    };
    const sql = fakeSql(store);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    const attempt = resolveConnectorCredential(sql, ARGS, { fetchImpl });
    await expect(attempt).rejects.toMatchObject({
      code: 'CREDENTIAL_NEEDS_REAUTH',
    });
    await expect(attempt).rejects.toThrow(/invalid_grant/);
    expect(sql.updates).toHaveLength(1);
  });

  it('refuses with a retryable code when the vendor is unreachable, leaving the row active', async () => {
    const store: Store = { row: row(EXPIRED) };
    const sql = fakeSql(store);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const attempt = resolveConnectorCredential(sql, ARGS, { fetchImpl });
    await expect(attempt).rejects.toMatchObject({
      code: 'CREDENTIAL_REFRESH_FAILED',
    });
    await expect(attempt).rejects.toThrow(/could not be reached/);
    expect(sql.updates).toEqual([]);
    expect(store.row.status).toBe('active');
  });

  it('refuses without flipping the row when no OAuth app can renew the grant', async () => {
    resolveConnectorOauthApp.mockResolvedValue(null);
    const store: Store = { row: row(EXPIRED) };
    const sql = fakeSql(store);
    const fetchImpl = vi.fn();
    const attempt = resolveConnectorCredential(sql, ARGS, { fetchImpl });
    await expect(attempt).rejects.toMatchObject({
      code: 'CREDENTIAL_REFRESH_FAILED',
    });
    await expect(attempt).rejects.toThrow(/CONNECTOR_OAUTH_SLACK_CLIENT_ID/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sql.updates).toEqual([]);
  });

  it('uses the row a concurrent refresh stored when the CAS is lost', async () => {
    const store: Store = {
      row: row(EXPIRED),
      casLostTo: row(
        {
          accessToken: 'winner-token',
          refreshToken: 'refresh-1',
          expiresAt: Date.now() + HOUR,
        },
        { updatedAt: 2000 },
      ),
    };
    const sql = fakeSql(store);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'loser-token', expires_in: 3600 }),
      );
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    });
    expect(resolved.authHeader).toBe('Bearer winner-token');
    // One attempted write; the winner's envelope stands.
    expect(sql.updates).toHaveLength(1);
    expect(envelopeOf(store).accessToken).toBe('winner-token');
  });

  it('leaves a non-oauth2 credential alone', async () => {
    const store: Store = {
      row: row(
        { accessToken: 'unused' },
        {
          connectorSlug: 'github',
          authMethod: 'bearer',
          encryptedData: encryptSecret(JSON.stringify({ token: 'ghp_1' })),
        },
      ),
    };
    const sql = fakeSql(store);
    const resolved = await resolveConnectorCredential(sql, {
      organizationId: 'org_1',
      connectorSlug: 'github',
    });
    expect(resolved.authHeader).toBe('Bearer ghp_1');
    expect(sql.updates).toEqual([]);
  });
});

describe('resolveCredentialRowForShim — oauth2 refresh', () => {
  it('answers the renewed envelope for an expired grant', async () => {
    const store: Store = { row: row(EXPIRED) };
    const sql = fakeSql(store);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }),
    );
    const answer = await resolveCredentialRowForShim(sql, ARGS);
    expect(sql.updates).toHaveLength(1);
    expect(answer).toMatchObject({
      _id: 'cred_1',
      status: 'active',
      encryptedData: store.row.encryptedData,
    });
    expect(envelopeOf(store).accessToken).toBe('fresh-token');
  });

  it('answers the needs-reauth row after a vendor-rejected refresh', async () => {
    const store: Store = { row: row({ ...EXPIRED, refreshToken: 'revoked' }) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'invalid_grant' }, 400),
    );
    const answer = await resolveCredentialRowForShim(fakeSql(store), ARGS);
    expect(answer).toMatchObject({
      status: 'needs-reauth',
      statusDetail: 'the vendor rejected the token refresh: invalid_grant',
    });
  });

  it('hands the stored row back, warned, when the vendor cannot be reached', async () => {
    const store: Store = { row: row(EXPIRED) };
    const sql = fakeSql(store);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const answer = await resolveCredentialRowForShim(sql, ARGS);
    expect(answer).toMatchObject({
      _id: 'cred_1',
      status: 'active',
      encryptedData: store.row.encryptedData,
    });
    expect(sql.updates).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('CREDENTIAL_REFRESH_FAILED'),
    );
  });

  it('rethrows what is not a credential refusal', async () => {
    resolveConnectorOauthApp.mockRejectedValue(new Error('db down'));
    await expect(
      resolveCredentialRowForShim(fakeSql({ row: row(EXPIRED) }), ARGS),
    ).rejects.toThrow('db down');
  });
});
