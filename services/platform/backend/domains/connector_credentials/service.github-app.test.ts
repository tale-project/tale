// @vitest-environment node

/**
 * A GitHub App the organization registered — the `github-app` seam. GitHub's
 * registration hands the platform the app and its private key, which only
 * the envelope keeps; once the app is installed, a call mints (or reuses) a
 * short-lived installation token narrowed to the connector's permissions the
 * installation grants, kept under the same compare-and-swap as an oauth2
 * refresh. A token that cannot be minted refuses the call; nothing takes its
 * place.
 *
 * Driven against a `sql` stand-in over fake rows and a GitHub stand-in that
 * records every request; the audit writer is a spy. The key is a real RSA
 * key, so the JWT is verified as GitHub verifies it.
 */

import { createPublicKey, generateKeyPairSync } from 'node:crypto';

import { managedConnectorCredentialTargetSchema } from '@tale/shared/schemas/managed-configuration';
import type { Context } from 'hono';
import { jwtVerify } from 'jose';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLiveHost,
  type LiveHostConnector,
} from '../../../lib/connectors/live-host.ts';
import { CONNECTOR_CREDENTIAL_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import type { OrgEnv } from '../../auth/org.ts';
import type { FetchLike } from '../../core/http_connectors/token_exchange.ts';
import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';

const { createAuditLog } = vi.hoisted(() => ({
  createAuditLog:
    vi.fn<(db: unknown, entry: Record<string, unknown>) => Promise<void>>(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'user_1', email: 'ada@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org_1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import {
  checkManagedConnectorCredential,
  readManagedConnectorCredential,
  writeManagedConnectorCredential,
} from './managed.ts';
import { createConnectorCredentialRoutes } from './routes.ts';
import {
  createCredential,
  createGithubAppCredentialInTransaction,
  deleteCredential,
  findGithubAppCredentialsByInstallation,
  listGithubAppInstallations,
  listGithubAppRepositories,
  readGithubAppInstallation,
  recordGithubAppInstallationInTransaction,
  resolveConnectorCredential,
  resolveCredentialRowForShim,
  type ResolvedConnectorCredential,
} from './service.ts';

const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = generateKeyPairSync(
  'rsa',
  {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  },
);
/** A line from the middle of the key: what any leak of it would carry. */
const KEY_LINE = PRIVATE_KEY.split('\n')[10] ?? '';

const APP = {
  appId: 4242,
  clientId: 'Iv23liTaleAcme01',
  slug: 'tale-acme',
  owner: 'acme',
  botId: 9001,
};
const INSTALLATION = {
  id: 777,
  account: 'acme',
  accountType: 'Organization',
  repositorySelection: 'selected',
} as const;
const MOVED = {
  id: 888,
  account: 'ada',
  accountType: 'User',
  repositorySelection: 'all',
} as const;
const TOKEN = 'ghs_installationTokenValue0123456789';
const PAT = 'ghp_personalAccessToken0123';
const HOUR = 3_600_000;
const ACTOR = { userId: 'user_1', email: 'ada@example.test' };
const ARGS = { organizationId: 'org_1', connectorSlug: 'github' };
const NOT_INSTALLED = 'the GitHub App is not installed on GitHub yet';
const UNINSTALLED = 'the GitHub App is no longer installed on GitHub';
const REGISTRATION_ONLY =
  'A GitHub App credential is created by registering the app from Settings → Connectors — its private key is never typed or replaced by hand.';
const NOT_DECLARABLE =
  'A credential whose access Tale renews is connected in Tale, never declared.';

/** What the installation grants: more than the connector asks in places,
 * less in others, and two of its permissions not at all. */
const GRANTED = {
  metadata: 'read',
  contents: 'write',
  issues: 'write',
  pull_requests: 'read',
  security_events: 'write',
  administration: 'write',
};
/** What a token asks for: each permission the connector names at the lower
 * of the two levels, and none the installation does not grant. */
const NARROWED = {
  metadata: 'read',
  contents: 'write',
  issues: 'write',
  pull_requests: 'read',
  security_events: 'read',
};

/** An hour from now, in whole seconds as GitHub states expiries. */
function inAnHour(): number {
  return Math.floor(Date.now() / 1000) * 1000 + HOUR;
}

function githubTime(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function needsReauth(detail: string): string {
  return `Credential "Tale bot" lost its authorization (${detail}) — reconnect "github" in Settings → Connectors to restore access.`;
}

// ------------------------------------------------------------------- rows

interface Row {
  id: string;
  organizationId: string;
  connectorSlug: string;
  authMethod: string;
  name: string;
  encryptedData: EncryptedSecret;
  endpointUrl: string | null;
  config: Record<string, unknown> | null;
  maskedPreview: string | null;
  clientApp: unknown;
  isDefault: boolean;
  mailSyncInboundSince: number | null;
  mailSyncOutboundSince: number | null;
  status: string;
  statusDetail: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface AppState {
  installation?: {
    id: number;
    account: string;
    accountType: 'User' | 'Organization';
    repositorySelection: 'all' | 'selected';
  };
  accessToken?: string;
  expiresAt?: number;
}

const installed: AppState = { installation: INSTALLATION };

function withToken(expiresAt: number, accessToken = TOKEN): AppState {
  return { installation: INSTALLATION, accessToken, expiresAt };
}

/** The app's credential, its envelope sealed around the key and `state`. */
function appRow(state: AppState, patch: Partial<Row> = {}): Row {
  const base: Row = {
    id: 'cred_app',
    organizationId: 'org_1',
    connectorSlug: 'github',
    authMethod: 'github-app',
    name: 'Tale bot',
    encryptedData: encryptSecret(
      JSON.stringify({ ...APP, privateKey: PRIVATE_KEY, ...state }),
    ),
    endpointUrl: null,
    config: null,
    maskedPreview: null,
    clientApp:
      state.installation === undefined
        ? { ...APP }
        : { ...APP, installation: state.installation },
    isDefault: true,
    mailSyncInboundSince: null,
    mailSyncOutboundSince: null,
    status: 'active',
    statusDetail: null,
    createdBy: 'user_1',
    createdAt: 1,
    updatedAt: 1000,
  };
  return Object.assign(base, patch);
}

/** A person's token for the same connector. */
function patRow(patch: Partial<Row> = {}): Row {
  const base: Row = {
    id: 'cred_pat',
    organizationId: 'org_1',
    connectorSlug: 'github',
    authMethod: 'bearer',
    name: 'CI token',
    encryptedData: encryptSecret(JSON.stringify({ token: PAT })),
    endpointUrl: null,
    config: null,
    maskedPreview: 'ghp_…23',
    clientApp: null,
    isDefault: false,
    mailSyncInboundSince: null,
    mailSyncOutboundSince: null,
    status: 'active',
    statusDetail: null,
    createdBy: 'user_1',
    createdAt: 2,
    updatedAt: 1000,
  };
  return Object.assign(base, patch);
}

interface Statement {
  text: string;
  values: unknown[];
}

interface Store {
  rows: Row[];
  /** Rows a concurrent writer stores, one just before each
   * compare-and-swap. */
  rivals: Row[];
  statements: Statement[];
}

/** A `sql` stand-in over `rows`: it answers each statement the seam sends
 * as Postgres would and records them all, normalized. */
function fakeSql(
  rows: Row[],
  rivals: Row[] = [],
): { sql: Sql; tx: TransactionSql; store: Store } {
  const store: Store = { rows, rivals, statements: [] };
  const copy = (row: Row): Row => Object.assign({}, row);
  const byId = (id: unknown): Row | undefined =>
    store.rows.find((row) => row.id === id);
  const matching = (keep: (row: Row) => boolean): Row[] =>
    store.rows.filter(keep).map(copy);
  const arriveRival = (): void => {
    const rival = store.rivals.shift();
    if (rival === undefined) return;
    const at = store.rows.findIndex((row) => row.id === rival.id);
    if (at >= 0) store.rows[at] = rival;
  };

  const answer = (text: string, v: unknown[]): unknown[] => {
    if (
      text.startsWith('INSERT INTO app_realtime.outbox') ||
      text.startsWith('SELECT pg_advisory_xact_lock') ||
      text.includes('FROM app.connector_oauth_apps')
    ) {
      return [];
    }
    if (text.startsWith('INSERT INTO app.connector_credentials')) {
      store.rows.push({
        id: 'cred_new',
        organizationId: String(v[0]),
        connectorSlug: String(v[1]),
        authMethod: String(v[2]),
        name: String(v[3]),
        encryptedData: v[4] as EncryptedSecret,
        endpointUrl: v[5] as string | null,
        config: v[6] as Record<string, unknown> | null,
        maskedPreview: v[7] as string | null,
        clientApp: v[8],
        isDefault: v[9] === true,
        mailSyncInboundSince: null,
        mailSyncOutboundSince: null,
        status: String(v[10]),
        statusDetail: v[11] as string | null,
        createdBy: String(v[12]),
        createdAt: Number(v[13]),
        updatedAt: Number(v[14]),
      });
      return [{ id: 'cred_new' }];
    }
    if (text.startsWith('DELETE FROM app.connector_credentials')) {
      store.rows = store.rows.filter((row) => row.id !== v[0]);
      return [];
    }
    if (text.includes("SET status = 'needs-reauth'")) {
      arriveRival();
      const row = byId(v[2]);
      if (!row || row.organizationId !== v[3] || row.updatedAt !== v[4])
        return [];
      Object.assign(row, {
        status: 'needs-reauth',
        statusDetail: v[0],
        updatedAt: v[1],
      });
      return [{ id: row.id }];
    }
    if (text.includes('AND updated_at_ms = ? RETURNING ?')) {
      arriveRival();
      const row = byId(v[4]);
      if (!row || row.organizationId !== v[5] || row.updatedAt !== v[6])
        return [];
      Object.assign(row, {
        encryptedData: v[0],
        maskedPreview: v[1],
        clientApp: v[2],
        updatedAt: v[3],
      });
      return [copy(row)];
    }
    if (
      text.includes(
        'SET encrypted_data = ?, masked_preview = ?, client_app = ?, status = ?',
      )
    ) {
      Object.assign(byId(v[6]) ?? {}, {
        encryptedData: v[0],
        maskedPreview: v[1],
        clientApp: v[2],
        status: v[3],
        statusDetail: v[4],
        updatedAt: v[5],
      });
      return [];
    }
    if (text.includes('SET is_default = true')) {
      Object.assign(byId(v[1]) ?? {}, { isDefault: true, updatedAt: v[0] });
      return [];
    }
    if (text.includes('SET is_default = false')) {
      for (const row of store.rows) {
        if (
          row.organizationId === v[1] &&
          row.connectorSlug === v[2] &&
          row.isDefault &&
          (v[3] === null || row.id !== v[4])
        ) {
          Object.assign(row, { isDefault: false, updatedAt: v[0] });
        }
      }
      return [];
    }
    if (text.includes('ANY(?::text[])')) {
      const organizationIds = v[0] as string[];
      return store.rows
        .filter(
          (row) =>
            row.authMethod === 'github-app' &&
            organizationIds.includes(row.organizationId) &&
            String(
              (row.clientApp as { installation?: { id: number } } | null)
                ?.installation?.id,
            ) === v[1],
        )
        .map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          connectorSlug: row.connectorSlug,
        }));
    }
    if (text.includes("auth_method = 'github-app' LIMIT 1")) {
      return matching(
        (row) =>
          row.id === v[1] &&
          row.organizationId === v[2] &&
          row.authMethod === 'github-app',
      );
    }
    if (text.includes('WHERE id = ? AND org_id = ? LIMIT 1')) {
      return matching((row) => row.id === v[1] && row.organizationId === v[2]);
    }
    if (text.includes('lower(name) = lower(?)')) {
      return matching(
        (row) =>
          row.organizationId === v[1] &&
          row.connectorSlug === v[2] &&
          row.name.toLowerCase() === String(v[3]).toLowerCase(),
      );
    }
    if (text.includes('(?::text IS NULL OR connector_slug = ?)')) {
      return matching(
        (row) =>
          row.organizationId === v[1] &&
          (v[2] === null || row.connectorSlug === v[2]),
      ).sort(
        (a, b) =>
          a.connectorSlug.localeCompare(b.connectorSlug) ||
          a.name.localeCompare(b.name),
      );
    }
    if (text.includes('WHERE org_id = ? AND connector_slug = ?')) {
      return matching(
        (row) => row.organizationId === v[1] && row.connectorSlug === v[2],
      );
    }
    throw new Error(`unexpected statement: ${text}`);
  };

  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): unknown => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    // A nested fragment (`FOR UPDATE`, or nothing) is a value of its
    // statement, not a statement.
    if (!/^(SELECT|INSERT|UPDATE|DELETE)\b/.test(text)) {
      return { fragment: text };
    }
    store.statements.push({ text, values });
    return new Promise((resolve) => {
      resolve(answer(text, values));
    });
  };
  const db = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
  });
  return {
    sql: db as unknown as Sql,
    tx: db as unknown as TransactionSql,
    store,
  };
}

function rowOf(store: Store, id = 'cred_app'): Row {
  const row = store.rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
}

function envelopeOf(row: Row): Record<string, unknown> {
  return JSON.parse(decryptSecret(row.encryptedData)) as Record<
    string,
    unknown
  >;
}

/** Every statement that changed a credential. */
function writes(store: Store): Statement[] {
  return store.statements.filter(
    (statement) =>
      !statement.text.startsWith('SELECT') &&
      !statement.text.startsWith('INSERT INTO app_realtime.outbox'),
  );
}

/** The realtime hints the writes emitted, as their bound values. */
function hints(store: Store): unknown[][] {
  return store.statements
    .filter((statement) =>
      statement.text.startsWith('INSERT INTO app_realtime.outbox'),
    )
    .map((statement) => statement.values);
}

function hintFor(credentialId: string): unknown[] {
  return ['org_1', null, CONNECTOR_CREDENTIAL_HINT_ENTITY, credentialId];
}

function audits(): Record<string, unknown>[] {
  return createAuditLog.mock.calls.map(([, entry]) => entry);
}

/** Everything written to the console, as one searchable text. */
function logged(): string {
  return JSON.stringify([
    vi.mocked(console.info).mock.calls,
    vi.mocked(console.warn).mock.calls,
    vi.mocked(console.error).mock.calls,
  ]);
}

// ----------------------------------------------------------------- GitHub

interface GithubCall {
  request: string;
  authorization: string | null;
  body?: unknown;
}

type GithubRoutes = Partial<Record<string, () => Response | Promise<Response>>>;

/** GitHub's API as `routes` answer it (`METHOD /path`), recording each
 * request with the credential it carried. */
function githubStandIn(routes: GithubRoutes): {
  fetchImpl: FetchLike;
  calls: GithubCall[];
} {
  const calls: GithubCall[] = [];
  const fetchImpl = vi.fn<FetchLike>(async (input, init) => {
    const method = init.method ?? 'GET';
    const call: GithubCall = {
      request: `${method} ${input}`,
      authorization: new Headers(init.headers).get('authorization'),
    };
    if (typeof init.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);
    const route = routes[`${method} ${new URL(input).pathname}`];
    if (route === undefined) {
      throw new Error(`the GitHub stand-in has no answer to ${call.request}`);
    }
    return route();
  });
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installationAnswer(patch: Record<string, unknown> = {}): Response {
  return json({
    id: 777,
    app_id: 4242,
    account: { login: 'acme', type: 'Organization' },
    repository_selection: 'selected',
    permissions: GRANTED,
    suspended_at: null,
    ...patch,
  });
}

function tokenAnswer(
  expiresAt: number,
  patch: Record<string, unknown> = {},
): Response {
  return json(
    {
      token: TOKEN,
      expires_at: githubTime(expiresAt),
      permissions: NARROWED,
      repository_selection: 'selected',
      ...patch,
    },
    201,
  );
}

function repo(fullName: string, isPrivate: boolean) {
  return {
    full_name: fullName,
    private: isPrivate,
    html_url: `https://github.com/${fullName}`,
  };
}

function repositoriesAnswer(
  totalCount: number,
  ...repositories: ReturnType<typeof repo>[]
): Response {
  return json({ total_count: totalCount, repositories });
}

/** GitHub minting a token for installation 777 that expires at
 * `expiresAt`. */
function mints(expiresAt = inAnHour()): GithubRoutes {
  return {
    'GET /app/installations/777': () => installationAnswer(),
    'POST /app/installations/777/access_tokens': () => tokenAnswer(expiresAt),
  };
}

const READ_INSTALLATION = 'GET https://api.github.com/app/installations/777';
const MINT_TOKEN =
  'POST https://api.github.com/app/installations/777/access_tokens';
const LIST_REPOSITORIES =
  'GET https://api.github.com/installation/repositories?per_page=100';

async function send(
  sql: Sql,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Response> {
  return await createConnectorCredentialRoutes({
    sql,
    auth: {} as never,
  }).request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
  createAuditLog.mockClear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// -------------------------------------------------------------- the doors

describe('the one door a GitHub App credential has', () => {
  it('[CCRED-R14] refuses a GitHub App typed into the create door, before any statement', async () => {
    const { sql, store } = fakeSql([]);
    await expect(
      createCredential(sql, {
        organizationId: 'org_1',
        connectorSlug: 'github',
        authMethod: 'github-app',
        name: 'Tale bot',
        secret: { token: PAT },
        createdBy: 'user_1',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_METHOD_NOT_SUPPORTED',
      status: 400,
      message: REGISTRATION_ONLY,
      data: { authMethod: 'github-app', reason: 'registration' },
    });
    expect(store.statements).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();

    const response = await send(sql, 'POST', '/', {
      connectorSlug: 'github',
      authMethod: 'github-app',
      name: 'Tale bot',
      secret: { token: PAT },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'invalid body',
      data: { issues: [{ path: 'authMethod' }] },
    });
    expect(store.statements).toEqual([]);
  });

  it('[CCRED-R14] refuses to replace the key of a stored app by hand', async () => {
    const { sql, store } = fakeSql([appRow(installed)]);
    const response = await send(sql, 'PATCH', '/cred_app', {
      secret: { token: PAT },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'AUTH_METHOD_NOT_SUPPORTED',
      message: REGISTRATION_ONLY,
      data: { authMethod: 'github-app', reason: 'registration' },
    });
    expect(store.statements.map((statement) => statement.text)).toEqual([
      'SELECT ? FROM app.connector_credentials WHERE id = ? AND org_id = ? LIMIT 1',
    ]);
    expect(envelopeOf(rowOf(store))).toEqual({
      ...APP,
      privateKey: PRIVATE_KEY,
      installation: INSTALLATION,
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('[CCRED-R14] keeps a GitHub App out of managed configuration: never declared, read or written as one', async () => {
    const declared = managedConnectorCredentialTargetSchema.safeParse({
      connector: 'github',
      name: 'Tale bot',
      authMethod: 'github-app',
    });
    expect(declared.error?.issues.map((issue) => issue.path)).toEqual([
      ['authMethod'],
    ]);

    const { sql, store } = fakeSql([appRow(installed)]);
    await expect(
      readManagedConnectorCredential(sql, 'org_1', 'github', 'Tale bot'),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_DECLARABLE',
      status: 409,
      message: NOT_DECLARABLE,
    });
    expect(
      await checkManagedConnectorCredential(sql, 'org_1', {
        connector: 'github',
        name: 'Tale bot',
        authMethod: 'bearer',
      }),
    ).toEqual({
      ok: false,
      issues: [
        {
          path: 'authMethod',
          code: 'CREDENTIAL_NOT_DECLARABLE',
          message: NOT_DECLARABLE,
        },
      ],
    });
    await expect(
      writeManagedConnectorCredential(sql, {
        organizationId: 'org_1',
        actor: ACTOR,
        config: { connector: 'github', name: 'Tale bot', authMethod: 'bearer' },
        secret: { token: PAT },
        expectedHash: null,
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_DECLARABLE', status: 409 });
    expect(writes(store)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('[CCRED-R19] connects a registered app as waiting for its installation, audited without its key', async () => {
    const { tx, store } = fakeSql([patRow({ isDefault: true })]);
    expect(
      await createGithubAppCredentialInTransaction(tx, {
        organizationId: 'org_1',
        connectorSlug: 'github',
        name: 'Tale bot',
        app: { ...APP, privateKey: PRIVATE_KEY },
        createdBy: 'user_1',
        actor: ACTOR,
      }),
    ).toEqual({ credentialId: 'cred_new' });

    const row = rowOf(store, 'cred_new');
    expect(row).toMatchObject({
      organizationId: 'org_1',
      connectorSlug: 'github',
      authMethod: 'github-app',
      name: 'Tale bot',
      endpointUrl: null,
      config: null,
      maskedPreview: null,
      isDefault: false,
      status: 'needs-reauth',
      statusDetail: NOT_INSTALLED,
      createdBy: 'user_1',
    });
    expect(row.clientApp).toEqual(APP);
    expect(envelopeOf(row)).toEqual({ ...APP, privateKey: PRIVATE_KEY });
    // The person's token stays the pair's default.
    expect(rowOf(store, 'cred_pat').isDefault).toBe(true);
    expect(
      store.statements.filter((statement) =>
        statement.text.includes('SET is_default'),
      ),
    ).toEqual([]);
    expect(audits()).toEqual([
      {
        organizationId: 'org_1',
        actorId: 'user_1',
        actorEmail: 'ada@example.test',
        actorType: 'user',
        action: 'connector_credential.created',
        category: 'connector',
        resourceType: 'connector_credential',
        resourceId: 'cred_new',
        resourceName: 'Tale bot',
        newState: {
          name: 'Tale bot',
          status: 'needs-reauth',
          isDefault: false,
        },
        metadata: {
          connectorSlug: 'github',
          authMethod: 'github-app',
          appId: 4242,
          appSlug: 'tale-acme',
          appOwner: 'acme',
        },
        status: 'success',
      },
    ]);
    expect(hints(store)).toEqual([hintFor('cred_new')]);
  });
});

// ------------------------------------------------------------ the private key

describe('what a GitHub App credential shows', () => {
  const PAT_VIEW = {
    id: 'cred_pat',
    connectorSlug: 'github',
    authMethod: 'bearer',
    name: 'CI token',
    maskedPreview: 'ghp_…23',
    isDefault: false,
    status: 'active',
    createdAt: 2,
    updatedAt: 1000,
  };
  const APP_VIEW = {
    id: 'cred_app',
    connectorSlug: 'github',
    authMethod: 'github-app',
    name: 'Tale bot',
    githubApp: { ...APP, installation: INSTALLATION },
    isDefault: true,
    status: 'active',
    createdAt: 1,
    updatedAt: 1000,
  };

  it('[CCRED-R15] lists and reads the app by its public identity, never its key or its token', async () => {
    const { sql } = fakeSql([appRow(withToken(inAnHour())), patRow()]);
    const listed = await send(sql, 'GET', '/');
    const one = await send(sql, 'GET', '/cred_app');
    const listText = await listed.text();
    const oneText = await one.text();

    expect(JSON.parse(listText)).toEqual({
      credentials: [
        PAT_VIEW,
        { ...APP_VIEW, defaultSuccessor: { id: 'cred_pat', name: 'CI token' } },
      ],
    });
    expect(JSON.parse(oneText)).toEqual(APP_VIEW);
    for (const text of [listText, oneText]) {
      expect(text).not.toContain(KEY_LINE);
      expect(text).not.toContain('PRIVATE KEY');
      expect(text).not.toContain(TOKEN);
    }
  });

  it('[CCRED-R15] keeps the key, the JWTs and the token out of every row, audit, log and answer, from connect to disconnect', async () => {
    expect(KEY_LINE).toHaveLength(64);
    const { sql, tx, store } = fakeSql([]);
    const github = githubStandIn({
      ...mints(),
      'GET /installation/repositories': () =>
        repositoriesAnswer(2, repo('acme/api', true), repo('acme/web', false)),
    });
    vi.stubGlobal('fetch', github.fetchImpl);

    const { credentialId } = await createGithubAppCredentialInTransaction(tx, {
      organizationId: 'org_1',
      connectorSlug: 'github',
      name: 'Tale bot',
      app: { ...APP, privateKey: PRIVATE_KEY },
      createdBy: 'user_1',
      actor: ACTOR,
    });
    const read = await readGithubAppInstallation(sql, {
      organizationId: 'org_1',
      credentialId,
      installationId: 777,
      fetchImpl: github.fetchImpl,
    });
    if (!read.ok) throw new Error(read.message);
    await recordGithubAppInstallationInTransaction(tx, {
      organizationId: 'org_1',
      credentialId,
      installation: read.installation,
      repositories: read.repositories,
      repositoryCount: read.repositoryCount,
      actor: ACTOR,
    });
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });
    expect(resolved.authHeader).toBe(`Bearer ${TOKEN}`);
    const answers: string[] = [];
    for (const path of [
      '/',
      `/${credentialId}`,
      `/${credentialId}/github-app/repositories`,
    ]) {
      const response = await send(sql, 'GET', path);
      expect(response.status).toBe(200);
      answers.push(await response.text());
    }
    await deleteCredential(sql, 'org_1', credentialId, ACTOR);

    const jwts = github.calls
      .filter((call) => call.request.includes('/app/installations/'))
      .map((call) => call.authorization?.replace('Bearer ', '') ?? '');
    expect(jwts).toHaveLength(4);
    const places = {
      statements: JSON.stringify(store.statements),
      audit: JSON.stringify(audits()),
      logs: logged(),
      answers: answers.join('\n'),
    };
    for (const [place, text] of Object.entries(places)) {
      for (const secret of [KEY_LINE, 'PRIVATE KEY', TOKEN, ...jwts]) {
        expect({ place, leaked: text.includes(secret) }).toEqual({
          place,
          leaked: false,
        });
      }
    }
    // The resolver's answer is for the call alone: the token, never the key.
    for (const secret of [KEY_LINE, 'PRIVATE KEY', ...jwts]) {
      expect(JSON.stringify(resolved)).not.toContain(secret);
    }
  });

  it('hands the shim the row as stored, minting nothing for it', async () => {
    const stored = appRow(installed);
    const { sql, store } = fakeSql([stored]);
    const fetchSpy = vi.fn<FetchLike>();
    vi.stubGlobal('fetch', fetchSpy);

    const answer = await resolveCredentialRowForShim(sql, ARGS);
    expect(answer).toEqual({
      _id: 'cred_app',
      organizationId: 'org_1',
      connectorSlug: 'github',
      authMethod: 'github-app',
      name: 'Tale bot',
      encryptedData: stored.encryptedData,
      status: 'active',
    });
    expect(answer?.encryptedData).toBe(stored.encryptedData);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes(store)).toEqual([]);
  });
});

// ------------------------------------------------------------ installation

describe('where the app is installed', () => {
  it('[CCRED-R17] reads an installation with an RS256 JWT issued a minute back and valid nine minutes, storing nothing', async () => {
    const nowMs = Date.UTC(2026, 10, 2, 9, 0, 0);
    const nowS = nowMs / 1000;
    const { sql, store } = fakeSql([
      appRow({}, { status: 'needs-reauth', statusDetail: NOT_INSTALLED }),
    ]);
    const github = githubStandIn({
      ...mints(),
      'GET /installation/repositories': () =>
        repositoriesAnswer(2, repo('acme/api', true), repo('acme/web', false)),
    });

    expect(
      await readGithubAppInstallation(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        installationId: 777,
        fetchImpl: github.fetchImpl,
        nowMs,
      }),
    ).toEqual({
      ok: true,
      appId: 4242,
      installation: INSTALLATION,
      repositories: ['acme/api', 'acme/web'],
      repositoryCount: 2,
    });

    const jwt = github.calls[0]?.authorization?.replace('Bearer ', '') ?? '';
    expect(github.calls).toEqual([
      { request: READ_INSTALLATION, authorization: `Bearer ${jwt}` },
      {
        request: MINT_TOKEN,
        authorization: `Bearer ${jwt}`,
        // The repositories are listed with a token that may read their
        // metadata and nothing else.
        body: { permissions: { metadata: 'read' } },
      },
      { request: LIST_REPOSITORIES, authorization: `Bearer ${TOKEN}` },
    ]);
    const { payload, protectedHeader } = await jwtVerify(
      jwt,
      createPublicKey(PUBLIC_KEY),
      { currentDate: new Date(nowMs) },
    );
    expect(protectedHeader).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toEqual({
      iss: APP.clientId,
      iat: nowS - 60,
      exp: nowS + 540,
    });
    expect(writes(store)).toEqual([]);
  });

  it.each([
    [
      'an installation of another app',
      {
        answer: () => installationAnswer({ app_id: 1 }),
        verdict: {
          ok: false,
          reason: 'wrong_app',
          message:
            'installation 777 belongs to another GitHub App, not "tale-acme"',
        },
      },
    ],
    [
      'a suspended installation',
      {
        answer: () =>
          installationAnswer({ suspended_at: '2026-11-01T08:00:00Z' }),
        verdict: {
          ok: false,
          reason: 'suspended',
          message: 'the installation of "tale-acme" on acme is suspended',
        },
      },
    ],
    [
      'an installation GitHub does not find',
      {
        answer: () => json({ message: 'Not Found' }, 404),
        verdict: { ok: false, reason: 'not_found', message: 'Not Found' },
      },
    ],
  ])(
    'refuses %s after one read, storing nothing',
    async (_case, { answer, verdict }) => {
      const { sql, store } = fakeSql([appRow({})]);
      const github = githubStandIn({ 'GET /app/installations/777': answer });
      expect(
        await readGithubAppInstallation(sql, {
          organizationId: 'org_1',
          credentialId: 'cred_app',
          installationId: 777,
          fetchImpl: github.fetchImpl,
        }),
      ).toEqual(verdict);
      expect(github.calls).toHaveLength(1);
      expect(writes(store)).toEqual([]);
    },
  );

  it('reads an installation on all repositories with one request', async () => {
    const { sql } = fakeSql([appRow({})]);
    const github = githubStandIn({
      'GET /app/installations/888': () =>
        installationAnswer({
          id: 888,
          account: { login: 'ada', type: 'User' },
          repository_selection: 'all',
        }),
    });
    expect(
      await readGithubAppInstallation(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        installationId: 888,
        fetchImpl: github.fetchImpl,
      }),
    ).toEqual({ ok: true, appId: 4242, installation: MOVED });
    expect(github.calls).toHaveLength(1);
  });

  it('leaves the repositories out when GitHub will not list them, and says why in the log', async () => {
    const { sql } = fakeSql([appRow({})]);
    const github = githubStandIn({
      ...mints(),
      'GET /installation/repositories': () =>
        json({ message: 'Bad credentials' }, 401),
    });
    expect(
      await readGithubAppInstallation(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        installationId: 777,
        fetchImpl: github.fetchImpl,
      }),
    ).toEqual({ ok: true, appId: 4242, installation: INSTALLATION });
    expect(console.warn).toHaveBeenCalledWith(
      '[connector-credentials] GitHub App 4242 could not list the repositories of installation 777 for credential cred_app: rejected (401)',
    );
  });

  it('finds no GitHub App behind the id of another credential, asking GitHub nothing', async () => {
    const { sql } = fakeSql([appRow({}), patRow()]);
    const github = githubStandIn({});
    await expect(
      readGithubAppInstallation(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_pat',
        installationId: 777,
        fetchImpl: github.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND', status: 404 });
    expect(github.calls).toEqual([]);
  });

  it('finds the credentials of an installation among the given organizations only', async () => {
    const { sql, store } = fakeSql([appRow(installed), patRow()]);
    expect(
      await findGithubAppCredentialsByInstallation(sql, {
        installationId: 777,
        organizationIds: [],
      }),
    ).toEqual([]);
    expect(store.statements).toEqual([]);

    expect(
      await findGithubAppCredentialsByInstallation(sql, {
        installationId: 777,
        organizationIds: ['org_1', 'org_2'],
      }),
    ).toEqual([
      { id: 'cred_app', organizationId: 'org_1', connectorSlug: 'github' },
    ]);
    expect(store.statements.at(-1)?.values).toEqual([
      ['org_1', 'org_2'],
      '777',
    ]);
    expect(
      await findGithubAppCredentialsByInstallation(sql, {
        installationId: 778,
        organizationIds: ['org_1'],
      }),
    ).toEqual([]);
    expect(
      await findGithubAppCredentialsByInstallation(sql, {
        installationId: 777,
        organizationIds: ['org_2'],
      }),
    ).toEqual([]);
  });

  it("[CCRED-R17] lists the app's installations with its JWT, storing and auditing nothing", async () => {
    const nowMs = Date.UTC(2026, 10, 2, 9, 0, 0);
    const nowS = nowMs / 1000;
    const { sql, store } = fakeSql([
      appRow({}, { status: 'needs-reauth', statusDetail: NOT_INSTALLED }),
    ]);
    const github = githubStandIn({
      'GET /app/installations': () =>
        json([
          {
            id: 777,
            app_id: 4242,
            account: { login: 'acme', type: 'Organization' },
            repository_selection: 'selected',
            permissions: GRANTED,
            suspended_at: null,
          },
          {
            id: 888,
            app_id: 4242,
            account: { login: 'ada', type: 'User' },
            repository_selection: 'all',
            permissions: { metadata: 'read' },
            suspended_at: '2026-11-01T08:00:00Z',
          },
        ]),
    });

    expect(
      await listGithubAppInstallations(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
        nowMs,
      }),
    ).toEqual({
      ok: true,
      value: [
        {
          id: 777,
          appId: 4242,
          account: 'acme',
          accountType: 'Organization',
          repositorySelection: 'selected',
          permissions: GRANTED,
          suspended: false,
        },
        {
          id: 888,
          appId: 4242,
          account: 'ada',
          accountType: 'User',
          repositorySelection: 'all',
          permissions: { metadata: 'read' },
          suspended: true,
        },
      ],
    });

    const jwt = github.calls[0]?.authorization?.replace('Bearer ', '') ?? '';
    expect(github.calls).toEqual([
      {
        request: 'GET https://api.github.com/app/installations?per_page=100',
        authorization: `Bearer ${jwt}`,
      },
    ]);
    const { payload } = await jwtVerify(jwt, createPublicKey(PUBLIC_KEY), {
      currentDate: new Date(nowMs),
    });
    expect(payload).toEqual({
      iss: APP.clientId,
      iat: nowS - 60,
      exp: nowS + 540,
    });
    expect(writes(store)).toEqual([]);
    expect(hints(store)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(logged()).not.toContain(jwt);
  });

  it.each([
    [
      'refuses',
      {
        answer: () =>
          json({ message: 'A JSON web token could not be decoded' }, 401),
        verdict: {
          ok: false,
          reason: 'rejected',
          status: 401,
          message: 'A JSON web token could not be decoded',
        },
        logged: 'rejected (401)',
      },
    ],
    [
      'cannot be reached for',
      {
        answer: (): Response => {
          throw new TypeError('fetch failed');
        },
        verdict: {
          ok: false,
          reason: 'unreachable',
          message: 'GitHub could not be reached (TypeError)',
        },
        logged: 'unreachable',
      },
    ],
  ])(
    '[CCRED-R15] hands back the verdict when GitHub %s the list, logged without the JWT or the key',
    async (_case, { answer, verdict, logged: reason }) => {
      const { sql, store } = fakeSql([appRow({})]);
      const github = githubStandIn({ 'GET /app/installations': answer });
      expect(
        await listGithubAppInstallations(sql, {
          organizationId: 'org_1',
          credentialId: 'cred_app',
          fetchImpl: github.fetchImpl,
        }),
      ).toEqual(verdict);
      expect(console.warn).toHaveBeenCalledWith(
        `[connector-credentials] GitHub App 4242 could not list its installations for credential cred_app: ${reason}`,
      );
      const jwt = github.calls[0]?.authorization?.replace('Bearer ', '') ?? '';
      expect(jwt.length).toBeGreaterThan(100);
      const logs = logged();
      for (const secret of [jwt, KEY_LINE, 'PRIVATE KEY']) {
        expect(logs).not.toContain(secret);
      }
      expect(github.calls).toHaveLength(1);
      expect(writes(store)).toEqual([]);
    },
  );

  it.each([
    ['of another method', 'org_1', 'cred_pat'],
    ['of another organization', 'org_2', 'cred_app'],
    ['nobody stored', 'org_1', 'cred_gone'],
  ])(
    'finds no GitHub App to list the installations of behind a credential %s, asking GitHub nothing',
    async (_case, organizationId, credentialId) => {
      const { sql } = fakeSql([appRow({}), patRow()]);
      const github = githubStandIn({});
      await expect(
        listGithubAppInstallations(sql, {
          organizationId,
          credentialId,
          fetchImpl: github.fetchImpl,
        }),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND', status: 404 });
      expect(github.calls).toEqual([]);
    },
  );
});

describe('recording and removing an installation', () => {
  it('[CCRED-R19] puts the app into service at its first installation, audited with what GitHub reported', async () => {
    const { tx, store } = fakeSql([
      appRow({}, { status: 'needs-reauth', statusDetail: NOT_INSTALLED }),
    ]);
    expect(
      await recordGithubAppInstallationInTransaction(tx, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        installation: INSTALLATION,
        repositories: ['acme/api', 'acme/web'],
        repositoryCount: 2,
        actor: ACTOR,
      }),
    ).toEqual({ changed: true });

    // The row is locked for the caller's transaction.
    expect(store.statements[0]?.values).toContainEqual({
      fragment: 'FOR UPDATE',
    });
    const row = rowOf(store);
    expect(row).toMatchObject({
      status: 'active',
      statusDetail: null,
      maskedPreview: null,
    });
    expect(row.clientApp).toEqual({ ...APP, installation: INSTALLATION });
    expect(envelopeOf(row)).toEqual({
      ...APP,
      privateKey: PRIVATE_KEY,
      installation: INSTALLATION,
    });
    expect(audits()).toEqual([
      {
        organizationId: 'org_1',
        actorId: 'user_1',
        actorEmail: 'ada@example.test',
        actorType: 'user',
        action: 'connector_credential.updated',
        category: 'connector',
        resourceType: 'connector_credential',
        resourceId: 'cred_app',
        resourceName: 'Tale bot',
        previousState: {
          name: 'Tale bot',
          status: 'needs-reauth',
          isDefault: true,
        },
        newState: { name: 'Tale bot', status: 'active', isDefault: true },
        changedFields: ['installation', 'status'],
        metadata: {
          connectorSlug: 'github',
          authMethod: 'github-app',
          appId: 4242,
          installationId: 777,
          account: 'acme',
          accountType: 'Organization',
          repositorySelection: 'selected',
          repositories: ['acme/api', 'acme/web'],
          repositoryCount: 2,
        },
        status: 'success',
      },
    ]);
    expect(hints(store)).toEqual([hintFor('cred_app')]);
  });

  it('[CCRED-R19] audits a return from GitHub that changed nothing, keeps a disabled app disabled and drops its token', async () => {
    const { tx, store } = fakeSql([
      appRow(withToken(inAnHour()), {
        status: 'disabled',
        statusDetail: 'paused by an admin',
      }),
    ]);
    expect(
      await recordGithubAppInstallationInTransaction(tx, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        installation: INSTALLATION,
        actor: ACTOR,
      }),
    ).toEqual({ changed: false });

    const row = rowOf(store);
    expect(row).toMatchObject({
      status: 'disabled',
      statusDetail: 'paused by an admin',
    });
    expect(envelopeOf(row)).toEqual({
      ...APP,
      privateKey: PRIVATE_KEY,
      installation: INSTALLATION,
    });
    expect(audits()).toMatchObject([
      {
        action: 'connector_credential.updated',
        previousState: { status: 'disabled' },
        newState: { status: 'disabled' },
        changedFields: [],
      },
    ]);
    expect(audits()[0]?.metadata).toEqual({
      connectorSlug: 'github',
      authMethod: 'github-app',
      appId: 4242,
      installationId: 777,
      account: 'acme',
      accountType: 'Organization',
      repositorySelection: 'selected',
    });
    expect(hints(store)).toEqual([hintFor('cred_app')]);
  });

  it('[CCRED-R19] audits an app moved to another installation with the one it left', async () => {
    const { tx, store } = fakeSql([appRow(installed)]);
    expect(
      await recordGithubAppInstallationInTransaction(tx, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        installation: MOVED,
        actor: ACTOR,
      }),
    ).toEqual({ changed: true });
    expect(rowOf(store).clientApp).toEqual({ ...APP, installation: MOVED });
    expect(audits()).toMatchObject([
      {
        changedFields: ['installation'],
        metadata: {
          installationId: 888,
          account: 'ada',
          accountType: 'User',
          repositorySelection: 'all',
          previousInstallationId: 777,
        },
      },
    ]);
  });

  it.each([
    ['the app of another organization', 'org_2', 'cred_app'],
    ['a credential of another method', 'org_1', 'cred_pat'],
    ['a credential that is gone', 'org_1', 'cred_gone'],
  ])('records no installation for %s', async (_case, organizationId, id) => {
    const { tx, store } = fakeSql([appRow({}), patRow()]);
    await expect(
      recordGithubAppInstallationInTransaction(tx, {
        organizationId,
        credentialId: id,
        installation: INSTALLATION,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND', status: 404 });
    expect(writes(store)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('[CCRED-R19] audits a disconnected app with its installation, handing the default on', async () => {
    const { sql, store } = fakeSql([appRow(installed), patRow()]);
    await deleteCredential(sql, 'org_1', 'cred_app', ACTOR);

    expect(store.rows.map((row) => row.id)).toEqual(['cred_pat']);
    expect(rowOf(store, 'cred_pat').isDefault).toBe(true);
    expect(audits()).toEqual([
      {
        organizationId: 'org_1',
        actorId: 'user_1',
        actorEmail: 'ada@example.test',
        actorType: 'user',
        action: 'connector_credential.deleted',
        category: 'connector',
        resourceType: 'connector_credential',
        resourceId: 'cred_app',
        resourceName: 'Tale bot',
        previousState: { name: 'Tale bot', status: 'active', isDefault: true },
        metadata: {
          connectorSlug: 'github',
          authMethod: 'github-app',
          promotedDefaultId: 'cred_pat',
          appId: 4242,
          installationId: 777,
          repositorySelection: 'selected',
        },
        status: 'success',
      },
    ]);
    expect(hints(store)).toEqual([hintFor('cred_app')]);
  });

  it('[CCRED-R19] audits a disconnected app nobody installed with the app alone', async () => {
    const { sql } = fakeSql([
      appRow({}, { status: 'needs-reauth', statusDetail: NOT_INSTALLED }),
    ]);
    await deleteCredential(sql, 'org_1', 'cred_app', ACTOR);
    expect(audits()).toMatchObject([
      {
        action: 'connector_credential.deleted',
        previousState: {
          name: 'Tale bot',
          status: 'needs-reauth',
          isDefault: true,
        },
      },
    ]);
    expect(audits()[0]?.metadata).toEqual({
      connectorSlug: 'github',
      authMethod: 'github-app',
      appId: 4242,
    });
  });
});

// ------------------------------------------------------------------ tokens

describe("a call's installation token", () => {
  it("[CCRED-R16] mints a token for the connector's permissions the installation grants, and keeps it", async () => {
    const expiresAt = inAnHour();
    const { sql, store } = fakeSql([appRow(installed)]);
    const github = githubStandIn(mints(expiresAt));

    const { reauthorize, ...resolved } = await resolveConnectorCredential(
      sql,
      ARGS,
      { fetchImpl: github.fetchImpl },
    );
    expect(resolved).toEqual({
      credentialId: 'cred_app',
      connectorSlug: 'github',
      authMethod: 'github-app',
      secrets: {},
      config: {},
      authHeader: `Bearer ${TOKEN}`,
    });
    // Should GitHub turn the token away before it expires, the live host
    // renews it [CCRED-R18].
    expect(reauthorize?.hosts).toEqual(['api.github.com']);
    expect(github.calls.map((call) => call.request)).toEqual([
      READ_INSTALLATION,
      MINT_TOKEN,
    ]);
    // Every repository the installation was given; the permissions narrowed.
    expect(github.calls[1]?.body).toEqual({ permissions: NARROWED });

    // Stored under the compare-and-swap on the row as it was read.
    const written = writes(store);
    expect(written).toHaveLength(1);
    expect(written[0]?.values[6]).toBe(1000);
    const row = rowOf(store);
    expect(envelopeOf(row)).toEqual({
      ...APP,
      privateKey: PRIVATE_KEY,
      installation: INSTALLATION,
      accessToken: TOKEN,
      expiresAt,
    });
    expect(row.maskedPreview).toBeNull();
    expect(row.clientApp).toEqual({ ...APP, installation: INSTALLATION });
    // A new token changes nothing a listing shows or the audit log records.
    expect(hints(store)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('[CCRED-R16] reuses the stored token until a minute before it expires', async () => {
    const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({});
    expect(
      await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      }),
    ).toMatchObject({ authHeader: `Bearer ${TOKEN}` });
    expect(github.calls).toEqual([]);
    expect(writes(store)).toEqual([]);
    expect(console.info).not.toHaveBeenCalled();
  });

  it('[CCRED-R16] mints a new token for one that expires within the minute', async () => {
    const { sql } = fakeSql([
      appRow(withToken(Date.now() + 30_000, 'ghs_almostExpiredToken')),
    ]);
    const github = githubStandIn(mints());
    expect(
      await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      }),
    ).toMatchObject({ authHeader: `Bearer ${TOKEN}` });
    expect(github.calls.map((call) => call.request)).toEqual([
      READ_INSTALLATION,
      MINT_TOKEN,
    ]);
  });

  it('[CCRED-R16] uses the token a concurrent call stored first instead of overwriting it', async () => {
    const rival = appRow(withToken(inAnHour(), 'ghs_rivalToken'), {
      updatedAt: 2000,
    });
    const { sql, store } = fakeSql([appRow(installed)], [rival]);
    const github = githubStandIn(mints());
    expect(
      await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      }),
    ).toMatchObject({ authHeader: 'Bearer ghs_rivalToken' });
    expect(github.calls).toHaveLength(2);
    expect(envelopeOf(rowOf(store)).accessToken).toBe('ghs_rivalToken');
  });

  it("[CCRED-R19] stores the installation as GitHub reports it at the mint, audited as the system's with the one before, and tells the open pages", async () => {
    const { sql, store } = fakeSql([appRow(installed)]);
    const github = githubStandIn({
      'GET /app/installations/777': () =>
        installationAnswer({ repository_selection: 'all' }),
      'POST /app/installations/777/access_tokens': () =>
        tokenAnswer(inAnHour(), { repository_selection: 'all' }),
    });
    await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });
    const reported = { ...INSTALLATION, repositorySelection: 'all' };
    expect(rowOf(store).clientApp).toEqual({ ...APP, installation: reported });
    expect(envelopeOf(rowOf(store)).installation).toEqual(reported);
    expect(hints(store)).toEqual([hintFor('cred_app')]);
    expect(audits()).toEqual([
      {
        organizationId: 'org_1',
        actorId: 'system',
        actorType: 'system',
        action: 'connector_credential.updated',
        category: 'connector',
        resourceType: 'connector_credential',
        resourceId: 'cred_app',
        resourceName: 'Tale bot',
        previousState: { name: 'Tale bot', status: 'active', isDefault: true },
        newState: { name: 'Tale bot', status: 'active', isDefault: true },
        changedFields: ['installation'],
        metadata: {
          connectorSlug: 'github',
          authMethod: 'github-app',
          appId: 4242,
          previousInstallation: {
            id: 777,
            account: 'acme',
            repositorySelection: 'selected',
          },
          installation: {
            id: 777,
            account: 'acme',
            repositorySelection: 'all',
          },
        },
        status: 'success',
      },
    ]);
    expect(JSON.stringify(audits())).not.toContain(TOKEN);
  });

  it('[CCRED-R19] audits no installation a mint found moved when another call stored its token first', async () => {
    const { sql, store } = fakeSql(
      [appRow(installed)],
      [appRow(withToken(inAnHour(), 'ghs_rivalToken'), { updatedAt: 2000 })],
    );
    const github = githubStandIn({
      'GET /app/installations/777': () =>
        installationAnswer({ repository_selection: 'all' }),
      'POST /app/installations/777/access_tokens': () =>
        tokenAnswer(inAnHour(), { repository_selection: 'all' }),
    });
    expect(
      await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      }),
    ).toMatchObject({ authHeader: 'Bearer ghs_rivalToken' });
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(hints(store)).toEqual([]);
  });

  it('[CCRED-R20] logs each mint, for a call or a repository list, with its installation, repositories and expiry, never the token, the JWT or the key', async () => {
    const expiresAt = inAnHour();
    const { sql } = fakeSql([appRow(installed)]);
    const github = githubStandIn({
      ...mints(expiresAt),
      'GET /installation/repositories': () =>
        repositoriesAnswer(2, repo('acme/api', true), repo('acme/web', false)),
    });
    await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });
    // A token reused from the store logs nothing.
    await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });
    await readGithubAppInstallation(sql, {
      organizationId: 'org_1',
      credentialId: 'cred_app',
      installationId: 777,
      fetchImpl: github.fetchImpl,
    });

    const expires = new Date(expiresAt).toISOString();
    expect(vi.mocked(console.info).mock.calls).toEqual([
      [
        `[connector-credentials] minted a GitHub App token for credential cred_app (connector call): app 4242, installation 777, repositories selected, expires ${expires}`,
      ],
      [
        `[connector-credentials] minted a GitHub App token for credential cred_app (repository list): app 4242, installation 777, repositories selected, expires ${expires}`,
      ],
    ]);
    const jwts = github.calls
      .filter((call) => call.request.includes('/app/installations/'))
      .map((call) => call.authorization?.replace('Bearer ', '') ?? '');
    expect(jwts).toHaveLength(4);
    for (const jwt of jwts) expect(jwt.length).toBeGreaterThan(100);
    const logs = logged();
    for (const secret of [TOKEN, ...jwts, KEY_LINE, 'PRIVATE KEY']) {
      expect(logs).not.toContain(secret);
    }
  });

  it.each([
    ['2', ['acme/api', 'acme/web'], '(2: acme/api, acme/web)'],
    [
      '25',
      Array.from({ length: 25 }, (_, at) => `acme/repo-${at + 1}`),
      `(25: ${Array.from({ length: 20 }, (_, at) => `acme/repo-${at + 1}`).join(', ')}, and 5 more)`,
    ],
  ])(
    '[CCRED-R20] logs the count and the first twenty names of the %s repositories a mint lists',
    async (_count, names, listed) => {
      const expiresAt = inAnHour();
      const { sql } = fakeSql([appRow(installed)]);
      const github = githubStandIn({
        'GET /app/installations/777': () => installationAnswer(),
        'POST /app/installations/777/access_tokens': () =>
          tokenAnswer(expiresAt, {
            repositories: names.map((name) => ({ full_name: name })),
          }),
        'GET /installation/repositories': () =>
          repositoriesAnswer(1, repo('acme/api', true)),
      });
      await listGithubAppRepositories(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
      });
      expect(vi.mocked(console.info).mock.calls).toEqual([
        [
          `[connector-credentials] minted a GitHub App token for credential cred_app (repository list): app 4242, installation 777, repositories selected ${listed}, expires ${new Date(expiresAt).toISOString()}`,
        ],
      ]);
      expect(logged()).not.toContain(TOKEN);
    },
  );
});

describe('a call whose token cannot be minted', () => {
  it('[CCRED-R18] refuses a call for an app nobody installed, asking GitHub nothing', async () => {
    const { sql, store } = fakeSql([
      appRow({}, { status: 'needs-reauth', statusDetail: NOT_INSTALLED }),
      patRow(),
    ]);
    const github = githubStandIn({});
    await expect(
      resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_NEEDS_REAUTH',
      message: needsReauth(NOT_INSTALLED),
    });
    expect(github.calls).toEqual([]);
    expect(writes(store)).toEqual([]);
  });

  it('[CCRED-R18] marks an active app without an installation as needing one, asking GitHub nothing', async () => {
    const { sql, store } = fakeSql([appRow({})]);
    const github = githubStandIn({});
    await expect(
      resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_NEEDS_REAUTH',
      message: needsReauth(NOT_INSTALLED),
    });
    expect(rowOf(store)).toMatchObject({
      status: 'needs-reauth',
      statusDetail: NOT_INSTALLED,
    });
    expect(hints(store)).toEqual([hintFor('cred_app')]);
    expect(github.calls).toEqual([]);
  });

  it.each([
    [
      'the installation read',
      {
        routes: {
          'GET /app/installations/777': () =>
            json({ message: 'Not Found' }, 404),
        },
        requests: [READ_INSTALLATION],
      },
    ],
    [
      'the token mint',
      {
        routes: {
          'GET /app/installations/777': () => installationAnswer(),
          'POST /app/installations/777/access_tokens': () =>
            json({ message: 'Not Found' }, 404),
        },
        requests: [READ_INSTALLATION, MINT_TOKEN],
      },
    ],
  ])(
    '[CCRED-R18] marks an app GitHub no longer finds at %s as needing a reinstall',
    async (_at, { routes, requests }) => {
      const { sql, store } = fakeSql([appRow(installed)]);
      const github = githubStandIn(routes);
      await expect(
        resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
      ).rejects.toMatchObject({
        code: 'CREDENTIAL_NEEDS_REAUTH',
        message: needsReauth(UNINSTALLED),
      });
      expect(github.calls.map((call) => call.request)).toEqual(requests);
      expect(rowOf(store)).toMatchObject({
        status: 'needs-reauth',
        statusDetail: UNINSTALLED,
      });
      expect(hints(store)).toEqual([hintFor('cred_app')]);
    },
  );

  it.each([
    [
      'a suspended installation',
      {
        routes: {
          'GET /app/installations/777': () =>
            installationAnswer({ suspended_at: '2026-11-01T08:00:00Z' }),
        },
        message:
          'Credential "Tale bot": GitHub has suspended the installation of "tale-acme" on acme — unsuspend it in the installation\'s settings on GitHub to restore access.',
      },
    ],
    [
      "an installation granting none of the connector's permissions",
      {
        routes: {
          'GET /app/installations/777': () =>
            installationAnswer({
              permissions: { administration: 'write', checks: 'read' },
            }),
        },
        message:
          'Credential "Tale bot": the installation of "tale-acme" on acme grants none of the permissions "github" asks for — accept the app\'s requested permissions in the installation\'s settings on GitHub.',
      },
    ],
    [
      'a JWT GitHub refuses',
      {
        routes: {
          'GET /app/installations/777': () =>
            json({ message: 'A JSON web token could not be decoded' }, 401),
        },
        message:
          'Credential "Tale bot": GitHub refused the app "tale-acme" a token (A JSON web token could not be decoded) — check the app\'s installation on GitHub, or register the app again in Settings → Connectors.',
      },
    ],
    [
      'a token GitHub refuses to mint',
      {
        routes: {
          'GET /app/installations/777': () => installationAnswer(),
          'POST /app/installations/777/access_tokens': () =>
            json({ message: 'Validation Failed' }, 422),
        },
        message:
          'Credential "Tale bot": GitHub refused the app "tale-acme" a token (Validation Failed) — check the app\'s installation on GitHub, or register the app again in Settings → Connectors.',
      },
    ],
  ])(
    "[CCRED-R18] refuses %s with GitHub's reason, sending nothing else",
    async (_case, { routes, message }) => {
      const { sql, store } = fakeSql([appRow(installed), patRow()]);
      const github = githubStandIn(routes);
      await expect(
        resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_APP_REFUSED', message });
      expect(rowOf(store).status).toBe('active');
      expect(writes(store)).toEqual([]);
      expect(JSON.stringify(github.calls)).not.toContain(PAT);
    },
  );

  it.each([
    [
      'GitHub failing the installation read',
      {
        routes: {
          'GET /app/installations/777': () =>
            json({ message: 'Service Unavailable' }, 503),
        },
        answered: 'could not be reached',
      },
    ],
    [
      'GitHub limiting the mint',
      {
        routes: {
          'GET /app/installations/777': () => installationAnswer(),
          'POST /app/installations/777/access_tokens': () =>
            json({ message: 'API rate limit exceeded' }, 429),
        },
        answered: 'could not be reached',
      },
    ],
    [
      'GitHub out of reach',
      {
        routes: {
          'GET /app/installations/777': () => {
            throw new TypeError('fetch failed');
          },
        },
        answered: 'could not be reached',
      },
    ],
    [
      'GitHub minting without a token',
      {
        routes: {
          'GET /app/installations/777': () => installationAnswer(),
          'POST /app/installations/777/access_tokens': () =>
            tokenAnswer(inAnHour(), { token: undefined }),
        },
        answered: 'answered without a usable one',
      },
    ],
  ])(
    '[CCRED-R18] refuses a call as retryable on %s, keeping the row as it is',
    async (_case, { routes, answered }) => {
      const { sql, store } = fakeSql([appRow(installed), patRow()]);
      const github = githubStandIn(routes);
      await expect(
        resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
      ).rejects.toMatchObject({
        code: 'CREDENTIAL_REFRESH_FAILED',
        message: `Credential "Tale bot" needs a new GitHub App token and GitHub ${answered} — try again shortly.`,
      });
      expect(rowOf(store).status).toBe('active');
      expect(writes(store)).toEqual([]);
      expect(JSON.stringify(github.calls)).not.toContain(PAT);
    },
  );

  it("[CCRED-R18] falls back to no other credential: a person's token serves only a call that names it", async () => {
    const { sql } = fakeSql([appRow(installed), patRow()]);
    const github = githubStandIn({
      'GET /app/installations/777': () =>
        json({ message: 'Service Unavailable' }, 503),
    });
    await expect(
      resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_REFRESH_FAILED' });
    expect(
      await resolveConnectorCredential(
        sql,
        { ...ARGS, credentialRef: 'CI token' },
        { fetchImpl: github.fetchImpl },
      ),
    ).toEqual({
      credentialId: 'cred_pat',
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: PAT, accessToken: PAT },
      config: {},
      authHeader: `Bearer ${PAT}`,
    });
    expect(github.calls).toHaveLength(1);
  });

  it('[CCRED-R18] refuses a call whose every try lost the race to store a token', async () => {
    const { sql, store } = fakeSql(
      [appRow(installed)],
      [
        appRow(installed, { updatedAt: 2000 }),
        appRow(installed, { updatedAt: 3000 }),
      ],
    );
    const github = githubStandIn(mints());
    await expect(
      resolveConnectorCredential(sql, ARGS, { fetchImpl: github.fetchImpl }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_REFRESH_FAILED',
      message:
        'Credential "Tale bot" changed while its GitHub App token was being minted — try again shortly.',
    });
    expect(github.calls.map((call) => call.request)).toEqual([
      READ_INSTALLATION,
      MINT_TOKEN,
      READ_INSTALLATION,
      MINT_TOKEN,
    ]);
    expect(hints(store)).toEqual([]);
  });

  it('[CCRED-R18] does not mark an app uninstalled when the row changed under the verdict: the row as it is now decides', async () => {
    const { sql, store } = fakeSql(
      [appRow(installed)],
      [appRow(withToken(inAnHour(), 'ghs_rivalToken'), { updatedAt: 2000 })],
    );
    const github = githubStandIn({
      'GET /app/installations/777': () => json({ message: 'Not Found' }, 404),
    });
    expect(
      await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      }),
    ).toMatchObject({ authHeader: 'Bearer ghs_rivalToken' });
    expect(github.calls).toHaveLength(1);
    expect(rowOf(store).status).toBe('active');
    expect(hints(store)).toEqual([]);
  });
});

// --------------------------------------------------- a token turned away

describe('a token GitHub turns away before it expires', () => {
  const GITHUB_API: LiveHostConnector = {
    name: 'github',
    endpointMode: 'fixed',
    allowedHosts: ['api.github.com'],
  };
  const COMMENTS = 'https://api.github.com/repos/acme/api/issues/1/comments';
  const COMMENT = JSON.stringify({ body: 'Looks good' });
  const RENEWED = 'ghs_renewedInstallationToken0123';
  const RIVAL = 'ghs_rivalToken';

  /** api.github.com as a connector's call reaches it: a comment is posted
   * with an `accepted` token, and any other is turned away (401). */
  function githubApi(...accepted: string[]) {
    const api = vi.fn<FetchLike>(async (_input, init) => {
      const authorization = new Headers(init.headers).get('authorization');
      return accepted.some((token) => authorization === `Bearer ${token}`)
        ? json({ id: 1 }, 201)
        : json({ message: 'Bad credentials' }, 401);
    });
    vi.stubGlobal('fetch', api);
    return api;
  }

  /** What each request to the API carried, in the order sent. */
  function sentTo(api: ReturnType<typeof githubApi>) {
    return api.mock.calls.map(([input, init]) => ({
      request: `${init.method ?? 'GET'} ${String(input)}`,
      authorization: new Headers(init.headers).get('authorization'),
      body: init.body,
    }));
  }

  /** The live host a call through `resolved` gets. */
  function hostFor(resolved: ResolvedConnectorCredential) {
    return createLiveHost({
      connector: GITHUB_API,
      ...(resolved.authHeader !== undefined && {
        authHeader: resolved.authHeader,
      }),
      ...(resolved.reauthorize !== undefined && {
        reauthorize: resolved.reauthorize,
      }),
    });
  }

  function postComment(resolved: ResolvedConnectorCredential) {
    return hostFor(resolved).http.post(COMMENTS, {
      headers: { 'Content-Type': 'application/json' },
      body: COMMENT,
    });
  }

  it.each([
    [
      'the installation read',
      {
        routes: {
          'GET /app/installations/777': () =>
            json({ message: 'Not Found' }, 404),
        },
        requests: [READ_INSTALLATION],
      },
    ],
    [
      'the token mint',
      {
        routes: {
          'GET /app/installations/777': () => installationAnswer(),
          'POST /app/installations/777/access_tokens': () =>
            json({ message: 'Not Found' }, 404),
        },
        requests: [READ_INSTALLATION, MINT_TOKEN],
      },
    ],
  ])(
    '[CCRED-R18] drops a token GitHub turned away and refuses the call when %s finds the app uninstalled',
    async (_at, { routes, requests }) => {
      const { sql, store } = fakeSql([appRow(withToken(inAnHour())), patRow()]);
      const pat = { ...rowOf(store, 'cred_pat') };
      const github = githubStandIn(routes);
      const api = githubApi(RENEWED);
      const resolved = await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      });

      await expect(postComment(resolved)).rejects.toMatchObject({
        code: 'CREDENTIAL_UNRESOLVED',
        message: `no usable credential for github: ${needsReauth(UNINSTALLED)}`,
      });
      // Sent once, with the app's token: nothing else went out.
      expect(sentTo(api)).toEqual([
        {
          request: `POST ${COMMENTS}`,
          authorization: `Bearer ${TOKEN}`,
          body: COMMENT,
        },
      ]);
      expect(github.calls.map((call) => call.request)).toEqual(requests);
      expect(console.warn).toHaveBeenCalledWith(
        '[connector-credentials] GitHub turned away the GitHub App token of "github" credential cred_app for organization org_1 (401); minting a new one',
      );
      const row = rowOf(store);
      expect(row).toMatchObject({
        status: 'needs-reauth',
        statusDetail: UNINSTALLED,
      });
      expect(envelopeOf(row)).toEqual({
        ...APP,
        privateKey: PRIVATE_KEY,
        installation: INSTALLATION,
      });
      expect(hints(store)).toEqual([hintFor('cred_app')]);
      // The person's token is neither touched nor sent.
      expect(rowOf(store, 'cred_pat')).toEqual(pat);
      expect(JSON.stringify(github.calls)).not.toContain(PAT);
      expect(logged()).not.toContain(TOKEN);
    },
  );

  it("[CCRED-R18] refuses a call GitHub turned away for a suspended installation with GitHub's reason", async () => {
    const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /app/installations/777': () =>
        installationAnswer({ suspended_at: '2026-11-02T09:10:00Z' }),
    });
    const api = githubApi(RENEWED);
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });

    await expect(postComment(resolved)).rejects.toMatchObject({
      code: 'CREDENTIAL_UNRESOLVED',
      message:
        'no usable credential for github: Credential "Tale bot": GitHub has suspended the installation of "tale-acme" on acme — unsuspend it in the installation\'s settings on GitHub to restore access.',
    });
    expect(api).toHaveBeenCalledTimes(1);
    expect(github.calls.map((call) => call.request)).toEqual([
      READ_INSTALLATION,
    ]);
    const row = rowOf(store);
    expect(row.status).toBe('active');
    expect(envelopeOf(row)).not.toHaveProperty('accessToken');
  });

  it('[CCRED-R18] posts the comment once more with a new token when GitHub only revoked the old one', async () => {
    const expiresAt = inAnHour();
    const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /app/installations/777': () => installationAnswer(),
      'POST /app/installations/777/access_tokens': () =>
        tokenAnswer(expiresAt, { token: RENEWED }),
    });
    const api = githubApi(RENEWED);
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });

    const response = await postComment(resolved);
    expect(response.status).toBe(201);
    const posted = { request: `POST ${COMMENTS}`, body: COMMENT };
    expect(sentTo(api)).toEqual([
      { ...posted, authorization: `Bearer ${TOKEN}` },
      { ...posted, authorization: `Bearer ${RENEWED}` },
    ]);
    expect(github.calls.map((call) => call.request)).toEqual([
      READ_INSTALLATION,
      MINT_TOKEN,
    ]);
    const row = rowOf(store);
    expect(row.status).toBe('active');
    expect(envelopeOf(row)).toEqual({
      ...APP,
      privateKey: PRIVATE_KEY,
      installation: INSTALLATION,
      accessToken: RENEWED,
      expiresAt,
    });
    expect(vi.mocked(console.info).mock.calls).toEqual([
      [
        `[connector-credentials] minted a GitHub App token for credential cred_app (connector call): app 4242, installation 777, repositories selected, expires ${new Date(expiresAt).toISOString()}`,
      ],
    ]);
    const logs = logged();
    for (const secret of [TOKEN, RENEWED]) expect(logs).not.toContain(secret);
  });

  it('[CCRED-R18] hands a refusal of the new token to the call as it is, sending nothing a third time', async () => {
    const { sql } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /app/installations/777': () => installationAnswer(),
      'POST /app/installations/777/access_tokens': () =>
        tokenAnswer(inAnHour(), { token: RENEWED }),
    });
    const api = githubApi();
    const resolved = await resolveConnectorCredential(sql, ARGS, {
      fetchImpl: github.fetchImpl,
    });

    const response = await postComment(resolved);
    expect(response.status).toBe(401);
    expect(sentTo(api).map((sent) => sent.authorization)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${RENEWED}`,
    ]);
    expect(github.calls.map((call) => call.request)).toEqual([
      READ_INSTALLATION,
      MINT_TOKEN,
    ]);
  });

  it.each([
    ['before the call reads the row again', 'read'],
    ['as the call drops the refused one', 'drop'],
  ])(
    '[CCRED-R18] sends the call again with the token another call stored %s, minting none',
    async (_when, at) => {
      const rival = appRow(withToken(inAnHour(), RIVAL), { updatedAt: 2000 });
      const kept = { ...rival };
      const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
      const github = githubStandIn({});
      const api = githubApi(RIVAL);
      const resolved = await resolveConnectorCredential(sql, ARGS, {
        fetchImpl: github.fetchImpl,
      });
      if (at === 'read') store.rows[0] = rival;
      else store.rivals.push(rival);

      const response = await postComment(resolved);
      expect(response.status).toBe(201);
      expect(sentTo(api).map((sent) => sent.authorization)).toEqual([
        `Bearer ${TOKEN}`,
        `Bearer ${RIVAL}`,
      ]);
      expect(github.calls).toEqual([]);
      expect(rowOf(store)).toEqual(kept);
    },
  );

  it("[CCRED-R18] hands a person's token GitHub turns away to the call as it is, renewing nothing", async () => {
    const { sql, store } = fakeSql([appRow(withToken(inAnHour())), patRow()]);
    const github = githubStandIn({});
    const api = githubApi();
    const resolved = await resolveConnectorCredential(
      sql,
      { ...ARGS, credentialRef: 'CI token' },
      { fetchImpl: github.fetchImpl },
    );
    expect(resolved).not.toHaveProperty('reauthorize');

    const response = await postComment(resolved);
    expect(response.status).toBe(401);
    expect(sentTo(api)).toEqual([
      {
        request: `POST ${COMMENTS}`,
        authorization: `Bearer ${PAT}`,
        body: COMMENT,
      },
    ]);
    expect(github.calls).toEqual([]);
    expect(writes(store)).toEqual([]);
    expect(logged()).not.toContain('turned away');
  });
});

// ------------------------------------------------------------ repositories

describe("the app's repositories", () => {
  it('lists them with the token its calls use, with where to change them on GitHub', async () => {
    const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /installation/repositories': () =>
        repositoriesAnswer(
          150,
          repo('acme/api', true),
          repo('acme/web', false),
        ),
    });
    expect(
      await listGithubAppRepositories(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
      }),
    ).toEqual({
      account: 'acme',
      accountType: 'Organization',
      repositorySelection: 'selected',
      totalCount: 150,
      repositories: [
        {
          fullName: 'acme/api',
          private: true,
          htmlUrl: 'https://github.com/acme/api',
        },
        {
          fullName: 'acme/web',
          private: false,
          htmlUrl: 'https://github.com/acme/web',
        },
      ],
      truncated: true,
      configureUrl:
        'https://github.com/organizations/acme/settings/installations/777',
    });
    expect(github.calls).toEqual([
      { request: LIST_REPOSITORIES, authorization: `Bearer ${TOKEN}` },
    ]);
    expect(writes(store)).toEqual([]);
  });

  it("mints the token first when none is live, and points a person's installation at their settings", async () => {
    const { sql } = fakeSql([appRow({ installation: MOVED })]);
    const github = githubStandIn({
      'GET /app/installations/888': () =>
        installationAnswer({
          id: 888,
          account: { login: 'ada', type: 'User' },
          repository_selection: 'all',
        }),
      'POST /app/installations/888/access_tokens': () =>
        tokenAnswer(inAnHour(), { repository_selection: 'all' }),
      'GET /installation/repositories': () =>
        repositoriesAnswer(1, repo('ada/notes', false)),
    });
    expect(
      await listGithubAppRepositories(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
      }),
    ).toEqual({
      account: 'ada',
      accountType: 'User',
      repositorySelection: 'all',
      totalCount: 1,
      repositories: [
        {
          fullName: 'ada/notes',
          private: false,
          htmlUrl: 'https://github.com/ada/notes',
        },
      ],
      truncated: false,
      configureUrl: 'https://github.com/settings/installations/888',
    });
    expect(github.calls.map((call) => call.request)).toEqual([
      'GET https://api.github.com/app/installations/888',
      'POST https://api.github.com/app/installations/888/access_tokens',
      LIST_REPOSITORIES,
    ]);
  });

  it('answers the repositories route with the listing', async () => {
    const { sql } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /installation/repositories': () =>
        repositoriesAnswer(1, repo('acme/api', true)),
    });
    vi.stubGlobal('fetch', github.fetchImpl);
    const response = await send(
      sql,
      'GET',
      '/cred_app/github-app/repositories',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      account: 'acme',
      accountType: 'Organization',
      repositorySelection: 'selected',
      totalCount: 1,
      repositories: [
        {
          fullName: 'acme/api',
          private: true,
          htmlUrl: 'https://github.com/acme/api',
        },
      ],
      truncated: false,
      configureUrl:
        'https://github.com/organizations/acme/settings/installations/777',
    });
    expect(github.calls).toHaveLength(1);
  });

  it.each([
    ['a credential of another method', 'cred_pat', 404, 'CREDENTIAL_NOT_FOUND'],
    ['a credential that is gone', 'cred_gone', 404, 'CREDENTIAL_NOT_FOUND'],
    ['an app nobody installed', 'cred_waiting', 400, 'CREDENTIAL_NEEDS_REAUTH'],
  ])(
    'refuses the repositories of %s, asking GitHub nothing',
    async (_case, id, status, error) => {
      const { sql } = fakeSql([
        appRow(
          {},
          {
            id: 'cred_waiting',
            status: 'needs-reauth',
            statusDetail: NOT_INSTALLED,
          },
        ),
        patRow(),
      ]);
      const github = githubStandIn({});
      vi.stubGlobal('fetch', github.fetchImpl);
      const response = await send(sql, 'GET', `/${id}/github-app/repositories`);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error });
      expect(github.calls).toEqual([]);
    },
  );

  it.each([
    [
      'refuses',
      {
        answer: () =>
          json({ message: 'Resource not accessible by integration' }, 403),
        code: 'CREDENTIAL_APP_REFUSED',
        message:
          'Credential "Tale bot": GitHub refused to list the repositories of "tale-acme" (Resource not accessible by integration) — check the app\'s installation on GitHub.',
        reason: 'rejected (403)',
      },
    ],
    [
      'cannot be reached',
      {
        answer: () => json({ message: 'Service Unavailable' }, 503),
        code: 'CREDENTIAL_REFRESH_FAILED',
        message:
          'Credential "Tale bot": GitHub could not be reached for the repositories of "tale-acme" — try again shortly.',
        reason: 'unreachable (503)',
      },
    ],
  ])(
    'says why when GitHub %s to list them',
    async (_case, { answer, code, message, reason }) => {
      const { sql } = fakeSql([appRow(withToken(inAnHour()))]);
      const github = githubStandIn({
        'GET /installation/repositories': answer,
      });
      await expect(
        listGithubAppRepositories(sql, {
          organizationId: 'org_1',
          credentialId: 'cred_app',
          fetchImpl: github.fetchImpl,
        }),
      ).rejects.toMatchObject({ code, message });
      expect(console.warn).toHaveBeenCalledWith(
        `[connector-credentials] "github" credential cred_app could not list the repositories of GitHub App 4242 for organization org_1: ${reason}`,
      );
      // Only a 401 renews the token.
      expect(github.calls).toHaveLength(1);
    },
  );

  /** GitHub's answers to the listing, one per request, in order. */
  function listings(...answers: (() => Response)[]): () => Response {
    let at = 0;
    return () => {
      const answer = answers[Math.min(at, answers.length - 1)];
      at += 1;
      if (answer === undefined) throw new Error('no listing answer');
      return answer();
    };
  }
  const RENEWED = 'ghs_renewedListingToken0123';
  const REFUSED = () => json({ message: 'Bad credentials' }, 401);

  it('[CCRED-R18] lists them with a new token when GitHub turned the stored one away', async () => {
    const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /installation/repositories': listings(REFUSED, () =>
        repositoriesAnswer(1, repo('acme/api', true)),
      ),
      'GET /app/installations/777': () => installationAnswer(),
      'POST /app/installations/777/access_tokens': () =>
        tokenAnswer(inAnHour(), { token: RENEWED }),
    });
    expect(
      await listGithubAppRepositories(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
      }),
    ).toMatchObject({
      totalCount: 1,
      repositories: [{ fullName: 'acme/api' }],
      truncated: false,
    });
    expect(github.calls).toEqual([
      { request: LIST_REPOSITORIES, authorization: `Bearer ${TOKEN}` },
      {
        request: READ_INSTALLATION,
        authorization: expect.stringMatching(/^Bearer eyJ/),
      },
      {
        request: MINT_TOKEN,
        authorization: expect.stringMatching(/^Bearer eyJ/),
        body: { permissions: NARROWED },
      },
      { request: LIST_REPOSITORIES, authorization: `Bearer ${RENEWED}` },
    ]);
    expect(envelopeOf(rowOf(store)).accessToken).toBe(RENEWED);
    expect(vi.mocked(console.info).mock.calls).toEqual([
      [expect.stringContaining('(repository list): app 4242')],
    ]);
  });

  it('[CCRED-R18] refuses the listing when GitHub turns the new token away too, asking no third time', async () => {
    const { sql } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /installation/repositories': REFUSED,
      'GET /app/installations/777': () => installationAnswer(),
      'POST /app/installations/777/access_tokens': () =>
        tokenAnswer(inAnHour(), { token: RENEWED }),
    });
    await expect(
      listGithubAppRepositories(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_APP_REFUSED',
      message:
        'Credential "Tale bot": GitHub refused to list the repositories of "tale-acme" (Bad credentials) — check the app\'s installation on GitHub.',
    });
    expect(github.calls.map((call) => call.request)).toEqual([
      LIST_REPOSITORIES,
      READ_INSTALLATION,
      MINT_TOKEN,
      LIST_REPOSITORIES,
    ]);
  });

  it('[CCRED-R18] shows an app uninstalled since its token was minted as needing its installation', async () => {
    const { sql, store } = fakeSql([appRow(withToken(inAnHour()))]);
    const github = githubStandIn({
      'GET /installation/repositories': REFUSED,
      'GET /app/installations/777': () => json({ message: 'Not Found' }, 404),
    });
    await expect(
      listGithubAppRepositories(sql, {
        organizationId: 'org_1',
        credentialId: 'cred_app',
        fetchImpl: github.fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_NEEDS_REAUTH',
      message: needsReauth(UNINSTALLED),
    });
    expect(github.calls.map((call) => call.request)).toEqual([
      LIST_REPOSITORIES,
      READ_INSTALLATION,
    ]);
    const row = rowOf(store);
    expect(row).toMatchObject({
      status: 'needs-reauth',
      statusDetail: UNINSTALLED,
    });
    expect(envelopeOf(row)).not.toHaveProperty('accessToken');
  });
});

// ----------------------------------------------------------------- catalog

describe('the settings catalog', () => {
  it("passes each connector's GitHub App permissions through to the Connectors page", async () => {
    const { sql } = fakeSql([]);
    const response = await send(sql, 'GET', '/catalog');
    expect(response.status).toBe(200);
    const { connectors } = (await response.json()) as {
      connectors: {
        slug: string;
        authMethods: string[];
        githubAppPermissions?: Record<string, string>;
      }[];
    };
    expect(
      connectors.find((connector) => connector.slug === 'github')
        ?.githubAppPermissions,
    ).toEqual({
      metadata: 'read',
      contents: 'write',
      issues: 'write',
      pull_requests: 'write',
      security_events: 'read',
      vulnerability_alerts: 'read',
      secret_scanning_alerts: 'read',
    });
    const others = connectors.filter(
      (connector) => !connector.authMethods.includes('github-app'),
    );
    expect(others.length).toBeGreaterThan(0);
    expect(
      others
        .filter((connector) => 'githubAppPermissions' in connector)
        .map((connector) => connector.slug),
    ).toEqual([]);
  });
});
