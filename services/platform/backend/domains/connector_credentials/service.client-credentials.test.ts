/**
 * An app that signs in as itself — the client-credentials seam. The
 * credential holds the organization's own registration (directory, client
 * ID, client secret); the platform asks the token endpoint for an access
 * token when the stored one is missing or about to expire, keeps it in the
 * envelope under the same compare-and-swap as an oauth2 refresh, and sends
 * only that token. Exercised against the shipped Outlook connector, whose
 * token URL names the directory (`{tenantId}`) and asks Graph's `.default`.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import {
  checkCredentialTarget,
  ConnectorCredentialError,
  createCredential,
  resolveConnectorCredential,
  resolveCredentialRowForShim,
} from './service.ts';

const HOUR = 3_600_000;
const TENANT = 'contoso.onmicrosoft.com';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const APP = {
  tenantId: TENANT,
  clientId: 'app-client-id',
  clientSecret: 'app-client-secret-value',
};

interface Envelope {
  tenantId?: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  expiresAt?: number;
}

type Row = Record<string, unknown> & {
  encryptedData: EncryptedSecret;
  updatedAt: number;
};

function row(secret: Envelope, patch: Record<string, unknown> = {}): Row {
  return {
    id: 'cred_1',
    organizationId: 'org_1',
    connectorSlug: 'outlook',
    authMethod: 'client-credentials',
    name: 'Promotion mailbox',
    encryptedData: encryptSecret(JSON.stringify(secret)),
    endpointUrl: null,
    config: { mailbox: 'promotion@example.com' },
    maskedPreview: 'app-…ue',
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

interface Store {
  row: Row;
  /** When set, the next CAS write finds this row already stored instead. */
  casLostTo?: Row;
}

/** A `sql` double over one credential row: reads answer the stored row, the
 * envelope's CAS write stores it (or, when a concurrent write got there
 * first, changes nothing), and every UPDATE is captured. */
function fakeSql(store: Store): Sql & { updates: unknown[][] } {
  const updates: unknown[][] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('UPDATE app.connector_credentials')) {
      updates.push(values);
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
    if (text.includes('FROM app.connector_credentials')) {
      return Promise.resolve([store.row]);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
    updates,
  }) as unknown as Sql & { updates: unknown[][] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function envelopeOf(store: Store): Envelope {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seam sealed exactly this shape
  return JSON.parse(decryptSecret(store.row.encryptedData)) as Envelope;
}

const ARGS = { organizationId: 'org_1', connectorSlug: 'outlook' };

let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resolveConnectorCredential — an app signing in as itself [CCRED-R9]', () => {
  it('asks the token endpoint as the app, in its directory, and keeps the token under a CAS', async () => {
    const store: Store = { row: row(APP) };
    const sql = fakeSql(store);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        token_type: 'Bearer',
        access_token: 'app-token-1',
        expires_in: 3599,
      }),
    );

    const before = Date.now();
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    });

    expect(resolved.authHeader).toBe('Bearer app-token-1');
    expect(resolved.config).toEqual({ mailbox: 'promotion@example.com' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'app-client-id',
      client_secret: 'app-client-secret-value',
      scope: 'https://graph.microsoft.com/.default',
    });
    // One write, guarded by the row's updated_at_ms; the registration kept.
    expect(sql.updates).toHaveLength(1);
    expect(sql.updates[0]).toContain(1000);
    const stored = envelopeOf(store);
    expect(stored).toMatchObject({ ...APP, accessToken: 'app-token-1' });
    expect(stored.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
    // The preview stays the client secret's, not the hourly token's.
    expect(store.row.maskedPreview).toBe('app-…ue');
    // The secret signs nothing but the token request.
    expect(Object.values(resolved.secrets)).not.toContain(
      'app-client-secret-value',
    );
  });

  it('reuses a token that is still valid: no token request, no write', async () => {
    const store: Store = {
      row: row({
        ...APP,
        accessToken: 'live-token',
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

  it('asks again for a token about to expire', async () => {
    const store: Store = {
      row: row({
        ...APP,
        accessToken: 'old-token',
        expiresAt: Date.now() + 10_000,
      }),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'new-token', expires_in: 3599 }),
      );

    const resolved = await resolveConnectorCredential(fakeSql(store), ARGS, {
      fetchImpl,
    });

    expect(resolved.authHeader).toBe('Bearer new-token');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('uses the token in hand when a concurrent write wins the CAS', async () => {
    const store: Store = { row: row(APP) };
    store.casLostTo = row(APP, { updatedAt: 2000 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'mine', expires_in: 3599 }),
      );

    const resolved = await resolveConnectorCredential(fakeSql(store), ARGS, {
      fetchImpl,
    });

    expect(resolved.authHeader).toBe('Bearer mine');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps a token that names no lifetime for this call only', async () => {
    const store: Store = { row: row(APP) };
    const sql = fakeSql(store);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'no-expiry' }));

    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    });

    expect(resolved.authHeader).toBe('Bearer no-expiry');
    expect(sql.updates).toEqual([]);
  });

  it('never writes the token or the client secret to the log', async () => {
    const store: Store = { row: row(APP) };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'invalid_client', error_description: 'x' }, 401),
      );

    await expect(
      resolveConnectorCredential(fakeSql(store), ARGS, { fetchImpl }),
    ).rejects.toThrow();

    const logged = JSON.stringify(warnings.mock.calls);
    expect(logged).not.toContain('app-client-secret-value');
    expect(logged).toContain('invalid_client');
  });
});

describe('resolveConnectorCredential — a refused app sign-in [CCRED-R10]', () => {
  it('says what to check, names the vendor code, and leaves the credential active', async () => {
    const store: Store = { row: row(APP) };
    const sql = fakeSql(store);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'invalid_client',
          error_description:
            'AADSTS7000222: The provided client secret keys are expired.',
        },
        401,
      ),
    );

    const refusal = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl,
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConnectorCredentialError);
    expect(refusal).toMatchObject({ code: 'CREDENTIAL_APP_REFUSED' });
    const message = (refusal as Error).message;
    expect(message).toContain('(invalid_client)');
    expect(message).toContain('client secret');
    expect(message).not.toContain('app-client-secret-value');
    expect(sql.updates).toEqual([]);
    expect(store.row.status).toBe('active');
  });

  it('refuses an unreachable token endpoint as retryable [CCRED-R6]', async () => {
    const store: Store = { row: row(APP) };
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      resolveConnectorCredential(fakeSql(store), ARGS, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_REFRESH_FAILED' });
    expect(store.row.status).toBe('active');
  });
});

describe('resolveCredentialRowForShim — an app signing in as itself', () => {
  it('hands out an envelope carrying the fetched token, even after a lost CAS', async () => {
    const store: Store = { row: row(APP) };
    store.casLostTo = row(APP, { updatedAt: 2000 });
    const sql = fakeSql(store);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'app-token-2', expires_in: 3599 }),
      );
    vi.stubGlobal('fetch', fetchImpl);

    const answer = await resolveCredentialRowForShim(sql, ARGS);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shim answers the sealed envelope
    const sealed = answer?.encryptedData as EncryptedSecret;
    expect(JSON.parse(decryptSecret(sealed))).toMatchObject({
      accessToken: 'app-token-2',
    });
    vi.unstubAllGlobals();
  });
});

describe('what an app sign-in needs before it is stored', () => {
  it('refuses a credential without the directory its token URL names', async () => {
    const sql = fakeSql({ row: row(APP) });
    await expect(
      createCredential(sql, {
        organizationId: 'org_1',
        connectorSlug: 'outlook',
        authMethod: 'client-credentials',
        name: 'Promotion mailbox',
        secret: { clientId: 'app-client-id', clientSecret: 'secret-value' },
        config: { mailbox: 'promotion@example.com' },
        createdBy: 'user_1',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_SECRET_INVALID' });
  });

  it('refuses an app sign-in that names no mailbox, and lets a person sign in without one [CONN-R29]', () => {
    expect(() =>
      checkCredentialTarget({
        connectorSlug: 'outlook',
        authMethod: 'client-credentials',
        creating: true,
      }),
    ).toThrow(/needs "Mailbox" for a client-credentials credential/);
    expect(() =>
      checkCredentialTarget({
        connectorSlug: 'outlook',
        authMethod: 'oauth2',
        creating: true,
      }),
    ).not.toThrow();
  });
});
