// @vitest-environment node

/**
 * A coding agent at the sign-in server, end to end through the provider
 * library itself: discovery, self-registration through Tale's checks, a
 * client identified by its metadata document, and an organization's own
 * application kept off the MCP endpoint. Better Auth's memory adapter
 * stands in for Postgres, as in the ID-token suite; the real-Postgres lane
 * (`checkAgentOAuth`) drives the same endpoints over HTTP.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { jwt, organization } from 'better-auth/plugins';
import { createLocalJWKSet, jwtVerify } from 'jose';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { connectAgent } from '../domains/agent_connections/service.ts';
import { AGENT_UNBOUND_REFERENCE_PREFIX } from './agent-consent.ts';
import type { AgentOAuthOptions } from './agent-oauth-config.ts';
import {
  agentClientDiscovery,
  seedMcpResources,
  withAgentOAuth,
} from './agent-oauth.ts';
import {
  createOidcProvider,
  OIDC_ORGANIZATION_CLAIM,
  OIDC_SCOPES,
} from './oidc.ts';

vi.mock('../lib/rate-limit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rate-limit.ts')>();
  return {
    ...actual,
    checkIpRateLimit: vi.fn(() => Promise.resolve()),
    checkKeyedRateLimit: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../domains/agent_connections/service.ts', () => ({
  connectAgent: vi.fn(() =>
    Promise.resolve({ connection: {}, created: true, scopesChanged: false }),
  ),
  agentConnectionActor: vi.fn((viewer: { userId: string }) =>
    Promise.resolve({ actorId: viewer.userId, actorType: 'user' }),
  ),
}));

const BASE = 'https://tale.example.com';
const ISSUER = `${BASE}/api/auth`;
const MCP = `${BASE}/api/v1/mcp`;
const DOCUMENT_URL = 'https://agent.example.test/oauth/client.json';
const AGENT_REDIRECT = 'http://127.0.0.1:33418/callback';
const APP_REDIRECT =
  'https://identity-client.example.test/api/auth/oauth2/callback/tale';
const AGENT_SCOPE_SET = [
  'tale:mcp',
  'tale:automations.write',
  'tale:automations.deploy',
  'tale:settings.read',
  'tale:settings.write',
  'tale:subscriptions.connect',
  'offline_access',
];

const OPTIONS: AgentOAuthOptions = {
  metadataDocuments: true,
  metadataHosts: [],
  dynamicRegistration: true,
  webRedirectHosts: ['claude.ai'],
};

type MemoryDb = Record<string, Record<string, unknown>[]>;

/** Tale's own reads beside the provider, answered from the memory tables:
 * the administrator check behind an application's registration, whether a
 * client is an agent client, and how many agents registered themselves. */
function memorySql(db: MemoryDb): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    const clients = db.oauthClient ?? [];
    const isAgent = (row: Record<string, unknown>) =>
      Array.isArray(row.scopes) && row.scopes.includes('tale:mcp');
    if (text.startsWith('SELECT "id", "organizationId", "userId", "role"')) {
      const [organizationId, userId] = values;
      return Promise.resolve(
        (db.member ?? []).filter(
          (row) =>
            row.organizationId === organizationId && row.userId === userId,
        ),
      );
    }
    if (text.startsWith('SELECT 1 AS found FROM "oauthClient"')) {
      const [clientId] = values;
      return Promise.resolve(
        clients
          .filter((row) => row.clientId === clientId && isAgent(row))
          .map(() => ({ found: 1 })),
      );
    }
    if (text.startsWith('INSERT INTO "oauthResource"')) {
      const [id, identifier, accessTokenTtl, refreshTokenTtl, allowedScopes] =
        values;
      const createdAt = values[5];
      (db.oauthResource ??= []).push({
        id,
        identifier,
        name: 'Tale MCP endpoint',
        accessTokenTtl,
        refreshTokenTtl,
        signingAlgorithm: null,
        signingKeyId: null,
        allowedScopes,
        customClaims: null,
        dpopBoundAccessTokensRequired: false,
        disabled: false,
        createdAt,
        updatedAt: createdAt,
        policyVersion: 1,
        metadata: values[7],
      });
      return Promise.resolve([]);
    }
    if (text.startsWith('UPDATE "oauthResource" SET "disabled" = true')) {
      return Promise.resolve([]);
    }
    if (
      text.startsWith(
        'SELECT count(*)::int AS count FROM ( SELECT 1 FROM "oauthClient"',
      )
    ) {
      return Promise.resolve([
        {
          count: clients.filter(
            (row) =>
              !row.clientDiscoveryId &&
              !row.referenceId &&
              !row.userId &&
              isAgent(row),
          ).length,
        },
      ]);
    }
    if (text.startsWith('SELECT o."id", o."slug", m."role"')) {
      const [organizationId, userId] = values;
      const organizationRow = (db.organization ?? []).find(
        (row) => row.id === organizationId,
      );
      const memberRow = (db.member ?? []).find(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );
      return Promise.resolve(
        organizationRow && memberRow
          ? [
              {
                id: organizationRow.id,
                slug: organizationRow.slug,
                role: memberRow.role,
              },
            ]
          : [],
      );
    }
    // The two-factor policy's membership list: none, so the default policy
    // (not enforced) applies.
    if (text.startsWith('SELECT "organizationId" FROM "member"')) {
      return Promise.resolve([]);
    }
    if (text.startsWith('SELECT "name", "clientDiscoveryId" AS "discovery"')) {
      const [clientId] = values;
      return Promise.resolve(
        clients
          .filter((row) => row.clientId === clientId)
          .map((row) => ({
            name: row.name ?? null,
            discovery: row.clientDiscoveryId ?? null,
          })),
      );
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  const json = (value: unknown) => value;
  const begin = (body: (tx: unknown) => Promise<unknown>) =>
    body(Object.assign(tag, { json }));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  return Object.assign(tag, { json, begin }) as unknown as Sql;
}

/** The agent's metadata document, served the way its host would; nothing
 * else answers. */
const fetchDocument: ClientMetadataResourceFetch = (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== DOCUMENT_URL) {
    return new Response('not found', { status: 404 });
  }
  return Response.json({
    client_id: DOCUMENT_URL,
    client_name: 'Agent Test',
    redirect_uris: [AGENT_REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
};

describe('a coding agent at the sign-in server', () => {
  const db: MemoryDb = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    organization: [],
    member: [],
    invitation: [],
    oauthClient: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
    oauthResource: [],
    oauthClientResource: [],
  };
  const sql = memorySql(db);
  const auth = betterAuth({
    baseURL: BASE,
    basePath: '/api/auth',
    secret: 'agent-oauth-flow-test-secret-long-enough',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: { alg: 'RS256' } },
        jwt: { issuer: ISSUER },
      }),
      createOidcProvider(sql, BASE, {
        dynamicRegistration: true,
        clientDiscovery: agentClientDiscovery({
          options: OPTIONS,
          siteOrigins: [BASE],
          fetchMetadataDocument: fetchDocument,
        }),
      }),
      organization(),
    ],
  });
  /** A request through Tale's agent steps and the provider, as the auth
   * mount serves it. */
  const call = (path: string, init: RequestInit = {}) =>
    withAgentOAuth(
      new Request(`${BASE}${path}`, init),
      {
        sql,
        options: OPTIONS,
        session: (headers) => auth.api.getSession({ headers }),
        clientIp: () => Promise.resolve('203.0.113.9'),
      },
      (request) => auth.handler(request),
    );
  let cookie = '';
  let personId = '';
  let orgId = '';

  const post = (path: string, body: unknown) =>
    call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, cookie },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    // The deployment answers on the issuer's origin alone.
    vi.stubEnv('SITE_URL', BASE);
    vi.stubEnv('ADDITIONAL_SITE_URLS', '');
    vi.stubEnv('BASE_PATH', '');
    // What the boot does once the provider's tables exist.
    await seedMcpResources(sql, [MCP]);
    const signUp = await post('/api/auth/sign-up/email', {
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      password: 'agent-flow-test-password',
    });
    expect(signUp.status).toBe(200);
    personId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signUp.json()).user.id;
    cookie = signUp.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
    // Verified the way an administrator's provisioning verifies it.
    for (const row of db.user ?? []) row.emailVerified = true;
    const created = await post('/api/auth/organization/create', {
      name: 'Acme',
      slug: 'acme',
    });
    expect(created.status).toBe(200);
    orgId = z.object({ id: z.string() }).parse(await created.json()).id;
    expect(
      (
        await post('/api/auth/organization/set-active', {
          organizationId: orgId,
        })
      ).status,
    ).toBe(200);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  /** An authorization request with S256 PKCE, signed in, as a browser
   * navigates it. */
  async function authorize(query: Record<string, string>): Promise<Response> {
    const verifier = randomBytes(32).toString('base64url');
    const response = await call(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: 'code',
        state: randomBytes(8).toString('base64url'),
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
        ...query,
      }).toString()}`,
      {
        headers: { cookie, Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
        redirect: 'manual',
      },
    );
    return response;
  }

  /** Where an authorization request sends the browser next. */
  async function nextStep(query: Record<string, string>): Promise<URL> {
    const response = await authorize(query);
    expect(response.status).toBe(302);
    return new URL(response.headers.get('location') ?? '/', BASE);
  }

  it('advertises metadata-document clients, public clients, PKCE, the refresh grant, registration and the agent scopes', async () => {
    const discovery = await call('/api/auth/.well-known/openid-configuration');
    expect(discovery.status).toBe(200);
    const metadata = z
      .looseObject({
        issuer: z.string(),
        client_id_metadata_document_supported: z.boolean(),
        token_endpoint_auth_methods_supported: z.array(z.string()),
        code_challenge_methods_supported: z.array(z.string()),
        authorization_response_iss_parameter_supported: z.boolean(),
        grant_types_supported: z.array(z.string()),
        registration_endpoint: z.string(),
        scopes_supported: z.array(z.string()),
      })
      .parse(await discovery.json());
    expect(metadata).toMatchObject({
      issuer: ISSUER,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      registration_endpoint: `${ISSUER}/oauth2/register`,
    });
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
    for (const scope of [...OIDC_SCOPES, ...AGENT_SCOPE_SET]) {
      expect(metadata.scopes_supported).toContain(scope);
    }
  });

  it('registers a CLI agent with a loopback redirect as a native app holding the agent scopes, owned by nobody', async () => {
    const response = await post('/api/auth/oauth2/register', {
      client_name: 'CLI agent',
      redirect_uris: ['http://localhost:8765/oauth/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(response.status).toBe(201);
    const client = z
      .looseObject({ client_id: z.string(), application_type: z.string() })
      .parse(await response.json());
    expect(client.application_type).toBe('native');
    const row = db.oauthClient?.find(
      (entry) => entry.clientId === client.client_id,
    );
    expect(row).toMatchObject({ scopes: AGENT_SCOPE_SET });
    // Registered with a session cookie on the request, yet owned by no
    // person and no organization: the registration lane is the agents' own.
    expect(row?.userId ?? null).toBeNull();
    expect(row?.referenceId ?? null).toBeNull();
  });

  it('creates the client a metadata document describes, and binds its request to the MCP endpoint', async () => {
    const next = await nextStep({
      client_id: DOCUMENT_URL,
      redirect_uri: AGENT_REDIRECT,
      scope: 'tale:mcp offline_access',
    });
    expect(next.pathname).toBe('/oauth/consent');
    expect(next.searchParams.get('resource')).toBe(MCP);
    expect(next.searchParams.get('client_id')).toBe(DOCUMENT_URL);
    expect(
      db.oauthClient?.find((entry) => entry.clientId === DOCUMENT_URL),
    ).toMatchObject({
      clientDiscoveryId: 'cimd',
      name: 'Agent Test',
      scopes: AGENT_SCOPE_SET,
      tokenEndpointAuthMethod: 'none',
    });
  });

  it('never fetches a client document from the deployment itself', async () => {
    const refused = await authorize({
      client_id: `${BASE}/agents/client.json`,
      redirect_uri: AGENT_REDIRECT,
      scope: 'tale:mcp',
    });
    // An unknown client is never sent back to the redirect it names.
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: 'invalid_client',
      error_description:
        "client_id URL is not permitted by the server's fetch policy",
    });
    expect(
      db.oauthClient?.some(
        (entry) => entry.clientId === `${BASE}/agents/client.json`,
      ),
    ).toBe(false);
  });

  it('keeps an organization’s own application off the MCP endpoint', async () => {
    const registered = z.object({ client_id: z.string() }).parse(
      await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie }),
        body: {
          client_name: 'Identity client',
          software_id: 'identity-client',
          redirect_uris: [APP_REDIRECT],
          scope: OIDC_SCOPES.join(' '),
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          application_type: 'web',
          require_pkce: true,
          skip_consent: false,
          metadata: { taleOrganizationId: 'org-acme' },
        },
      }),
    );
    // Registering it linked it to no resource: the MCP endpoint's scope
    // allowlist is what keeps it off.
    expect(db.oauthClientResource).toEqual([]);
    const asked = await nextStep({
      client_id: registered.client_id,
      redirect_uri: APP_REDIRECT,
      scope: OIDC_SCOPES.join(' '),
      nonce: 'n',
      resource: MCP,
    });
    expect(asked.origin + asked.pathname).toBe(APP_REDIRECT);
    expect(asked.searchParams.get('error')).toBe('invalid_scope');
    // An agent scope is not the application's to ask for.
    const widened = await nextStep({
      client_id: registered.client_id,
      redirect_uri: APP_REDIRECT,
      scope: 'openid tale:mcp',
      nonce: 'n',
    });
    expect(widened.searchParams.get('error')).toBe('invalid_scope');
  });

  it('knows the MCP endpoint as the resource the boot seeded, taking the agent scopes only', () => {
    expect(db.oauthResource).toEqual([
      expect.objectContaining({
        identifier: MCP,
        accessTokenTtl: 300,
        refreshTokenTtl: 30 * 86_400,
        allowedScopes: AGENT_SCOPE_SET,
        disabled: false,
      }),
    ]);
  });

  /** An agent's authorization request, signed in: its PKCE verifier and the
   * signed query the consent page would hand back. */
  async function startConnect(scope: string) {
    const verifier = randomBytes(32).toString('base64url');
    const response = await call(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: DOCUMENT_URL,
        redirect_uri: AGENT_REDIRECT,
        response_type: 'code',
        scope,
        state: 'agent-state',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString()}`,
      {
        headers: { cookie, Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
        redirect: 'manual',
      },
    );
    const next = new URL(response.headers.get('location') ?? '/', BASE);
    expect(next.pathname).toBe('/oauth/consent');
    return { verifier, oauthQuery: next.search.slice(1) };
  }

  /** What the consent page does when the person allows: the consent for the
   * organization they chose, then the code the agent exchanges. */
  async function allow(
    scope: string,
    chosenOrganization: string = orgId,
    asked: string = scope,
  ) {
    const { verifier, oauthQuery } = await startConnect(asked);
    const consent = await post('/api/auth/oauth2/consent', {
      accept: true,
      scope,
      oauth_query: oauthQuery,
      tale: { organizationId: chosenOrganization },
    });
    return { consent, verifier, oauthQuery };
  }

  const codeOf = async (consent: Response): Promise<string> => {
    const url = new URL(
      z.object({ url: z.string() }).parse(await consent.json()).url,
    );
    expect(url.origin + url.pathname).toBe(AGENT_REDIRECT);
    return url.searchParams.get('code') ?? '';
  };

  const tokenRequest = (fields: Record<string, string>) =>
    call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DOCUMENT_URL, ...fields }),
    });

  const tokensSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
  });

  /** An access token as the MCP door will read it: signed by the issuer. */
  async function claimsOf(accessToken: string) {
    const jwks = z
      .object({ keys: z.array(z.record(z.string(), z.unknown())) })
      .parse(await (await call('/api/auth/jwks')).json());
    return (
      await jwtVerify(accessToken, createLocalJWKSet(jwks), {
        issuer: ISSUER,
        audience: MCP,
        algorithms: ['RS256'],
      })
    ).payload;
  }

  it('connects an agent to the organization the person chose: the consent, the code and every token name it', async () => {
    vi.mocked(connectAgent).mockClear();
    const { consent, verifier } = await allow(
      'tale:mcp tale:automations.write offline_access',
    );
    expect(consent.status).toBe(200);
    const code = await codeOf(consent);
    expect(code).not.toBe('');
    expect(connectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: orgId,
        userId: personId,
        clientId: DOCUMENT_URL,
        clientName: 'Agent Test',
        provenance: 'metadata_document',
        redirectHost: '127.0.0.1',
        scopes: ['tale:mcp', 'tale:automations.write'],
      }),
    );
    expect(db.oauthConsent).toEqual([
      expect.objectContaining({
        clientId: DOCUMENT_URL,
        userId: personId,
        referenceId: orgId,
      }),
    ]);
    const exchanged = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: AGENT_REDIRECT,
      code_verifier: verifier,
    });
    expect(exchanged.status).toBe(200);
    const tokens = tokensSchema.parse(await exchanged.json());
    const claims = await claimsOf(tokens.access_token);
    expect(claims).toMatchObject({
      sub: personId,
      aud: MCP,
      client_id: DOCUMENT_URL,
      scope: 'tale:mcp tale:automations.write offline_access',
      [OIDC_ORGANIZATION_CLAIM]: { id: orgId, slug: 'acme', role: 'owner' },
    });
    // The refresh token names the organization too, and every refresh asks
    // the claims again.
    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(
      (await claimsOf(tokensSchema.parse(await refreshed.json()).access_token))[
        OIDC_ORGANIZATION_CLAIM
      ],
    ).toMatchObject({ id: orgId, role: 'owner' });
  });

  it('answers a refresh by a person who left the organization as an invalid grant, and a code exchange with the refusal it always had [AGCONN-R7]', async () => {
    const { consent, verifier } = await allow('tale:mcp offline_access');
    const exchanged = await tokenRequest({
      grant_type: 'authorization_code',
      code: await codeOf(consent),
      redirect_uri: AGENT_REDIRECT,
      code_verifier: verifier,
    });
    const tokens = tokensSchema.parse(await exchanged.json());
    const seats = db.member ?? [];
    const kept = [...seats];
    db.member = [];
    try {
      const refused = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        error: 'invalid_grant',
        error_description:
          'the person can no longer use the organization this connection was made for',
      });
    } finally {
      db.member = kept;
    }
  });

  it('makes no code for an agent consent that went around the gate: it is tied to no organization, and the person is sent back to the consent page', async () => {
    const { oauthQuery } = await startConnect('tale:mcp');
    const direct = await auth.handler(
      new Request(`${BASE}/api/auth/oauth2/consent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: BASE,
          cookie,
        },
        body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
      }),
    );
    expect(direct.status).toBe(200);
    const redirect = z.object({ url: z.string() }).parse(await direct.json());
    expect(new URL(redirect.url, BASE).pathname).toBe('/oauth/consent');
    expect(redirect.url).not.toContain('code=');
    expect(String(db.oauthConsent?.at(-1)?.referenceId)).toMatch(
      new RegExp(`^${AGENT_UNBOUND_REFERENCE_PREFIX}`),
    );
  });

  it('earns no token from a code made for no organization', async () => {
    // A code the provider would make for a request tied to the unbound
    // reference: a person who is not a member of what the reference names
    // gets no claims, so no token.
    const { consent, verifier } = await allow('tale:mcp offline_access');
    const code = await codeOf(consent);
    const kept = [...(db.member ?? [])];
    db.member = [];
    try {
      const exchanged = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: AGENT_REDIRECT,
        code_verifier: verifier,
      });
      expect(exchanged.status).toBe(403);
      expect(await exchanged.json()).toMatchObject({
        message: 'IDENTITY_NOT_ELIGIBLE',
      });
    } finally {
      db.member = kept;
    }
  });

  it('makes no consent when the gate refuses, however it refuses', async () => {
    const before = db.oauthConsent?.length ?? 0;
    for (const tale of [undefined, { organizationId: 'org-nobody' }]) {
      const { verifier: _verifier, oauthQuery } =
        await startConnect('tale:mcp');
      const refused = await post('/api/auth/oauth2/consent', {
        accept: true,
        oauth_query: oauthQuery,
        ...(tale === undefined ? {} : { tale }),
      });
      expect(refused.status).toBe(tale === undefined ? 400 : 403);
    }
    expect(db.oauthConsent?.length ?? 0).toBe(before);
  });

  it('keeps two consents at once apart: each is made for the organization its person chose', async () => {
    const created = await post('/api/auth/organization/create', {
      name: 'Beta',
      slug: 'beta',
    });
    expect(created.status).toBe(200);
    const beta = z.object({ id: z.string() }).parse(await created.json()).id;
    const [inAcme, inBeta] = await Promise.all([
      allow('tale:mcp offline_access', orgId),
      allow('tale:mcp offline_access', beta),
    ]);
    const tokens = await Promise.all(
      [inAcme, inBeta].map(async (entry) =>
        tokensSchema.parse(
          await (
            await tokenRequest({
              grant_type: 'authorization_code',
              code: await codeOf(entry.consent),
              redirect_uri: AGENT_REDIRECT,
              code_verifier: entry.verifier,
            })
          ).json(),
        ),
      ),
    );
    const organizations = await Promise.all(
      tokens.map(
        async (entry) =>
          (await claimsOf(entry.access_token))[OIDC_ORGANIZATION_CLAIM],
      ),
    );
    expect(organizations).toEqual([
      expect.objectContaining({ id: orgId, slug: 'acme' }),
      expect.objectContaining({ id: beta, slug: 'beta' }),
    ]);
  });
});
