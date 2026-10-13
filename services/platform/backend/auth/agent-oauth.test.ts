// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endAgentConnectionsAndTellInTx } from '../domains/agent_connections/end-and-tell.ts';
import {
  checkIpRateLimit,
  checkKeyedRateLimit,
  RateLimitExceededError,
} from '../lib/rate-limit.ts';
import type { AgentOAuthOptions } from './agent-oauth-config.ts';
import {
  agentClientDiscovery,
  authorizePrecheck,
  chargeTokenFailure,
  mcpResourceFor,
  mcpResourceIdentifiers,
  metadataDocumentAllowed,
  protectedResourceMetadata,
  protectedResourceMetadataAnswer,
  protectedResourceMetadataUrl,
  registerPrecheck,
  seedMcpResources,
  SELF_REGISTERED_CLIENT_CAP,
  withAgentOAuth,
} from './agent-oauth.ts';

vi.mock('../lib/rate-limit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rate-limit.ts')>();
  return {
    ...actual,
    checkIpRateLimit: vi.fn(() => Promise.resolve()),
    checkKeyedRateLimit: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../domains/agent_connections/end-and-tell.ts', () => ({
  endAgentConnectionsAndTellInTx: vi.fn(() =>
    Promise.resolve([{ id: 'conn-1' }]),
  ),
}));

const SITE = 'https://tale.example.com';
const ISSUER = `${SITE}/api/auth`;

const OPTIONS: AgentOAuthOptions = {
  metadataDocuments: true,
  metadataHosts: [],
  dynamicRegistration: true,
  webRedirectHosts: ['claude.ai', 'vscode.dev'],
};

/** The reads the steps make, answered from a few facts: how many agents
 * registered themselves, and which registered clients are agents. */
function fakeSql(facts: {
  selfRegistered?: number;
  agentClients?: readonly string[];
}): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    queries.push(text);
    if (
      text.startsWith(
        'SELECT count(*)::int AS count FROM ( SELECT 1 FROM "oauthClient"',
      )
    ) {
      return Promise.resolve([{ count: facts.selfRegistered ?? 0 }]);
    }
    if (text.startsWith('SELECT 1 AS found FROM "oauthClient"')) {
      const [clientId] = values;
      return Promise.resolve(
        (facts.agentClients ?? []).includes(String(clientId))
          ? [{ found: 1 }]
          : [],
      );
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  return { sql: tag as unknown as Sql, queries };
}

const clientIp = () => Promise.resolve('203.0.113.9');

function registration(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${SITE}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function registered(step: Awaited<ReturnType<typeof registerPrecheck>>) {
  if (step.kind !== 'continue') throw new Error('the registration was refused');
  return {
    request: step.request,
    body: (await step.request.json()) as Record<string, unknown>,
  };
}

async function refusal(step: Awaited<ReturnType<typeof registerPrecheck>>) {
  if (step.kind !== 'answer') throw new Error('the registration passed');
  return {
    status: step.response.status,
    body: (await step.response.json()) as Record<string, unknown>,
    headers: step.response.headers,
  };
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', SITE);
  vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://tale.partner.example');
  vi.stubEnv('BASE_PATH', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(checkIpRateLimit).mockReset();
  vi.mocked(checkKeyedRateLimit).mockReset();
  vi.mocked(checkIpRateLimit).mockResolvedValue(undefined);
  vi.mocked(checkKeyedRateLimit).mockResolvedValue(undefined);
});

describe('the MCP endpoint as an OAuth resource', () => {
  it('is one resource per address the deployment answers on, canonical first, base path kept', () => {
    expect(
      mcpResourceIdentifiers(
        ['https://Tale.Example.com', 'https://tale.partner.example', SITE],
        '',
      ),
    ).toEqual([
      'https://tale.example.com/api/v1/mcp',
      'https://tale.partner.example/api/v1/mcp',
    ]);
    expect(mcpResourceIdentifiers([SITE], '/tale')).toEqual([
      'https://tale.example.com/tale/api/v1/mcp',
    ]);
  });

  it('names the configured address a request arrived on, never a Host the deployment does not answer on', () => {
    const on = (host: string) =>
      mcpResourceFor(
        new Request('http://backend-api:3005/api/v1/mcp', {
          headers: { host, 'x-forwarded-proto': 'https' },
        }),
      );
    expect(on('tale.partner.example')).toBe(
      'https://tale.partner.example/api/v1/mcp',
    );
    expect(on('evil.example')).toBe('https://tale.example.com/api/v1/mcp');
    vi.stubEnv('BASE_PATH', '/tale/');
    expect(on('tale.example.com')).toBe(
      'https://tale.example.com/tale/api/v1/mcp',
    );
  });

  it('keeps its metadata at its own path after the well-known prefix (RFC 9728 §3.1)', () => {
    expect(
      protectedResourceMetadataUrl('https://tale.example.com/api/v1/mcp'),
    ).toBe(
      'https://tale.example.com/.well-known/oauth-protected-resource/api/v1/mcp',
    );
    expect(
      protectedResourceMetadataUrl('https://tale.example.com/tale/api/v1/mcp'),
    ).toBe(
      'https://tale.example.com/.well-known/oauth-protected-resource/tale/api/v1/mcp',
    );
  });

  it('describes itself with the canonical issuer, every scope it takes and bearer tokens only — no DPoP', () => {
    const metadata = protectedResourceMetadata(
      'https://tale.example.com/api/v1/mcp',
      ISSUER,
    );
    expect(metadata).toEqual({
      resource: 'https://tale.example.com/api/v1/mcp',
      authorization_servers: [ISSUER],
      scopes_supported: [
        'tale:mcp',
        'tale:automations.write',
        'tale:automations.deploy',
        'tale:settings.read',
        'tale:settings.write',
        'tale:subscriptions.connect',
        'offline_access',
      ],
      bearer_methods_supported: ['header'],
      resource_name: 'Tale',
    });
    expect(JSON.stringify(metadata)).not.toContain('dpop');
  });

  it('answers its metadata at its path and at the root, per host, and 404 for any other path', async () => {
    const ask = (path: string, host = 'tale.example.com') =>
      protectedResourceMetadataAnswer(
        new Request(`http://backend-api:3005${path}`, {
          headers: { host, 'x-forwarded-proto': 'https' },
        }),
        ISSUER,
        OPTIONS,
      );
    for (const path of [
      '/.well-known/oauth-protected-resource/api/v1/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const answer = ask(path);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('cache-control')).toBe('public, max-age=300');
      expect(answer.headers.get('vary')).toBe('Host');
      expect(await answer.json()).toMatchObject({
        resource: 'https://tale.example.com/api/v1/mcp',
        authorization_servers: [ISSUER],
      });
    }
    // Another configured address describes its own resource; the issuer
    // stays the canonical one.
    expect(
      await ask(
        '/.well-known/oauth-protected-resource/api/v1/mcp',
        'tale.partner.example',
      ).json(),
    ).toMatchObject({
      resource: 'https://tale.partner.example/api/v1/mcp',
      authorization_servers: [ISSUER],
    });
    const other = ask('/.well-known/oauth-protected-resource/api/v1/contacts');
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({
      error: 'Not found',
      code: 'NOT_FOUND',
    });
  });

  it('names no resource while agents have no way in, and one as soon as either way is on', async () => {
    const ask = (given: AgentOAuthOptions) =>
      protectedResourceMetadataAnswer(
        new Request(
          'http://backend-api:3005/.well-known/oauth-protected-resource',
          {
            headers: { host: 'tale.example.com', 'x-forwarded-proto': 'https' },
          },
        ),
        ISSUER,
        given,
      );
    const closed = ask({
      ...OPTIONS,
      metadataDocuments: false,
      dynamicRegistration: false,
    });
    expect(closed.status).toBe(404);
    expect(closed.headers.get('cache-control')).toBe('no-store');
    for (const one of [
      { metadataDocuments: true, dynamicRegistration: false },
      { metadataDocuments: false, dynamicRegistration: true },
    ]) {
      expect(ask({ ...OPTIONS, ...one }).status).toBe(200);
    }
  });
});

describe('the MCP endpoint’s resource rows', () => {
  /** A transaction that records what it was asked. */
  function recordingSql() {
    const statements: { text: string; values: unknown[] }[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({
        text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
        values,
      });
      return Promise.resolve([]);
    };
    const json = (value: unknown) => ({ json: value });
    const sql = Object.assign(tag, {
      json,
      begin: (body: (tx: unknown) => Promise<unknown>) => body(sql),
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
    return { sql: sql as unknown as Sql, statements };
  }

  it('writes one row per address with the configured lifetimes and scopes, and takes the rest out of issuance', async () => {
    const { sql, statements } = recordingSql();
    const now = new Date('2026-10-10T12:00:00Z');
    await seedMcpResources(
      sql,
      [
        'https://tale.example.com/api/v1/mcp',
        'https://tale.partner.example/api/v1/mcp',
      ],
      now,
    );
    const inserts = statements.filter((statement) =>
      statement.text.startsWith('INSERT INTO "oauthResource"'),
    );
    expect(inserts.map((statement) => statement.values[1])).toEqual([
      'https://tale.example.com/api/v1/mcp',
      'https://tale.partner.example/api/v1/mcp',
    ]);
    for (const insert of inserts) {
      expect(insert.text).toContain('ON CONFLICT ("identifier") DO UPDATE SET');
      expect(insert.values.slice(2)).toEqual([
        300,
        30 * 86_400,
        {
          json: [
            'tale:mcp',
            'tale:automations.write',
            'tale:automations.deploy',
            'tale:settings.read',
            'tale:settings.write',
            'tale:subscriptions.connect',
            'offline_access',
          ],
        },
        now,
        now,
        { json: { taleResource: 'mcp' } },
      ]);
    }
    const retired = statements.at(-1);
    expect(retired?.text).toBe(
      'UPDATE "oauthResource" SET "disabled" = true, "updatedAt" = ? WHERE "metadata" @> ? AND NOT ("identifier" = ANY(?)) AND "disabled" = false',
    );
    expect(retired?.values).toEqual([
      now,
      { json: { taleResource: 'mcp' } },
      [
        'https://tale.example.com/api/v1/mcp',
        'https://tale.partner.example/api/v1/mcp',
      ],
    ]);
  });

  it('writes nothing for a deployment that names no address', async () => {
    const { sql, statements } = recordingSql();
    await seedMcpResources(sql, []);
    expect(statements).toEqual([]);
  });
});

describe('client metadata documents', () => {
  it('are never fetched from the deployment itself, and only from the listed hosts when the operator lists any', () => {
    const origins = [SITE, 'https://tale.partner.example'];
    expect(
      metadataDocumentAllowed(
        'https://claude.ai/oauth/claude-code-client-metadata',
        [],
        origins,
      ),
    ).toBe(true);
    expect(
      metadataDocumentAllowed(
        'https://tale.example.com/evil/client.json',
        [],
        origins,
      ),
    ).toBe(false);
    expect(
      metadataDocumentAllowed(
        'https://tale.partner.example:8443/client.json',
        [],
        origins,
      ),
    ).toBe(false);
    expect(
      metadataDocumentAllowed(
        'https://claude.ai/oauth/claude-code-client-metadata',
        ['agents.example.com'],
        origins,
      ),
    ).toBe(false);
    expect(
      metadataDocumentAllowed(
        'https://agents.example.com/client.json',
        ['agents.example.com'],
        origins,
      ),
    ).toBe(true);
  });

  it('are a client discovery only while the operator leaves them on, advertised in discovery', () => {
    expect(
      agentClientDiscovery({
        options: { ...OPTIONS, metadataDocuments: false },
        siteOrigins: [SITE],
      }),
    ).toBeNull();
    const discovery = agentClientDiscovery({
      options: OPTIONS,
      siteOrigins: [SITE],
    });
    expect(discovery?.id).toBe('cimd');
    expect(discovery?.discoveryMetadata).toEqual({
      client_id_metadata_document_supported: true,
    });
    expect(discovery?.matches('https://claude.ai/oauth/client')).toBe(true);
    expect(discovery?.matches('aRegisteredClientId')).toBe(false);
  });
});

describe('an agent registering itself', () => {
  it('passes the request on as it came while the operator keeps registration off', async () => {
    const { sql } = fakeSql({});
    const request = registration({ redirect_uris: ['http://127.0.0.1/cb'] });
    const step = await registerPrecheck(request, {
      sql,
      clientIp,
      options: { ...OPTIONS, dynamicRegistration: false },
    });
    expect(step).toEqual({ kind: 'continue', request });
    expect(checkIpRateLimit).not.toHaveBeenCalled();
  });

  it('registers an agent with only local redirects as the native app it is, and never as the caller’s session', async () => {
    const { sql } = fakeSql({});
    const { request, body } = await registered(
      await registerPrecheck(
        registration(
          {
            client_name: 'Gemini CLI',
            redirect_uris: ['http://localhost:7777/oauth/callback'],
            token_endpoint_auth_method: 'none',
          },
          { cookie: 'better-auth.session_token=signed-in-person' },
        ),
        { sql, clientIp, options: OPTIONS },
      ),
    );
    expect(body).toEqual({
      client_name: 'Gemini CLI',
      redirect_uris: ['http://localhost:7777/oauth/callback'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    });
    expect(request.headers.get('cookie')).toBeNull();
    expect(checkIpRateLimit).toHaveBeenCalledWith(
      sql,
      'oauth:register-ip',
      '203.0.113.9',
    );
    expect(checkKeyedRateLimit).toHaveBeenCalledWith(
      sql,
      'oauth:register-global',
      'global',
    );
  });

  it('leaves an agent that names its type, or a web redirect, as it said', async () => {
    const { sql } = fakeSql({});
    const named = await registered(
      await registerPrecheck(
        registration({
          application_type: 'web',
          redirect_uris: ['http://127.0.0.1:9/cb'],
        }),
        { sql, clientIp, options: OPTIONS },
      ),
    );
    expect(named.body.application_type).toBe('web');
    const web = await registered(
      await registerPrecheck(
        registration({
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        }),
        { sql, clientIp, options: OPTIONS },
      ),
    );
    expect(web.body.application_type).toBeUndefined();
    const app = await registered(
      await registerPrecheck(
        registration({ redirect_uris: ['com.example.agent:/callback'] }),
        { sql, clientIp, options: OPTIONS },
      ),
    );
    expect(app.body.application_type).toBe('native');
  });

  it('refuses a web redirect to a host that is not a known agent’s', async () => {
    const { sql } = fakeSql({});
    expect(
      await refusal(
        await registerPrecheck(
          registration({
            redirect_uris: ['https://evil.example/callback'],
          }),
          { sql, clientIp, options: OPTIONS },
        ),
      ),
    ).toMatchObject({
      status: 400,
      body: {
        error: 'invalid_redirect_uri',
        error_description:
          'this server accepts web redirects only to known agent hosts; use a local (loopback) redirect',
      },
    });
  });

  it('refuses grants, response types, keys, auth methods and scopes an agent client never needs', async () => {
    const { sql } = fakeSql({});
    for (const [body, description] of [
      [
        { grant_types: ['client_credentials'] },
        'grant_types may name authorization_code and refresh_token only',
      ],
      [{ response_types: ['token'] }, 'response_types may name code only'],
      [
        { jwks_uri: 'https://agent.example/jwks' },
        'a self-registered client signs in without keys of its own: leave out jwks and jwks_uri',
      ],
      [
        { token_endpoint_auth_method: 'private_key_jwt' },
        'token_endpoint_auth_method may be none, client_secret_basic or client_secret_post',
      ],
      [
        { scope: 'tale:mcp openid' },
        'scope may name only tale:mcp, tale:automations.write, tale:automations.deploy, tale:settings.read, tale:settings.write, tale:subscriptions.connect, offline_access',
      ],
    ] as const) {
      expect(
        await refusal(
          await registerPrecheck(
            registration({
              ...body,
              redirect_uris: ['http://127.0.0.1/cb'],
            }),
            { sql, clientIp, options: OPTIONS },
          ),
        ),
      ).toMatchObject({
        status: 400,
        body: {
          error: 'invalid_client_metadata',
          error_description: description,
        },
      });
    }
  });

  it('refuses a registration past 16 KiB', async () => {
    const { sql } = fakeSql({});
    expect(
      await refusal(
        await registerPrecheck(
          registration({ client_name: 'x'.repeat(17 * 1024) }),
          { sql, clientIp, options: OPTIONS },
        ),
      ),
    ).toMatchObject({
      status: 400,
      body: { error: 'invalid_client_metadata' },
    });
  });

  it('answers 429 past ten an hour from one source or 500 a day overall, before the provider sees it', async () => {
    const { sql, queries } = fakeSql({});
    vi.mocked(checkIpRateLimit).mockRejectedValueOnce(
      new RateLimitExceededError('over', 1_500_000),
    );
    const bySource = await refusal(
      await registerPrecheck(
        registration({ redirect_uris: ['http://127.0.0.1/cb'] }),
        { sql, clientIp, options: OPTIONS },
      ),
    );
    expect(bySource).toMatchObject({
      status: 429,
      body: { error: 'temporarily_unavailable' },
    });
    expect(bySource.headers.get('retry-after')).toBe('1500');
    expect(queries).toEqual([]);
    vi.mocked(checkKeyedRateLimit).mockRejectedValueOnce(
      new RateLimitExceededError('over', 60_000),
    );
    expect(
      await refusal(
        await registerPrecheck(
          registration({ redirect_uris: ['http://127.0.0.1/cb'] }),
          { sql, clientIp, options: OPTIONS },
        ),
      ),
    ).toMatchObject({
      status: 429,
      body: { error: 'temporarily_unavailable' },
    });
  });

  it('takes no new agent once 5,000 registered themselves', async () => {
    const { sql } = fakeSql({ selfRegistered: SELF_REGISTERED_CLIENT_CAP });
    expect(
      await refusal(
        await registerPrecheck(
          registration({ redirect_uris: ['http://127.0.0.1/cb'] }),
          { sql, clientIp, options: OPTIONS },
        ),
      ),
    ).toMatchObject({
      status: 503,
      body: { error: 'temporarily_unavailable' },
    });
  });

  it('hands a body that is not a JSON object to the provider to refuse in its own words, without the cookie', async () => {
    const { sql } = fakeSql({});
    const step = await registerPrecheck(
      registration('{not json', { cookie: 'a=b' }),
      { sql, clientIp, options: OPTIONS },
    );
    if (step.kind !== 'continue') throw new Error('refused here');
    expect(await step.request.text()).toBe('{not json');
    expect(step.request.headers.get('cookie')).toBeNull();
  });
});

describe('an agent’s authorization request', () => {
  const authorize = (query: Record<string, string>) =>
    new Request(
      `http://backend-api:3005/api/auth/oauth2/authorize?${new URLSearchParams(query).toString()}`,
      { headers: { host: 'tale.example.com', 'x-forwarded-proto': 'https' } },
    );

  it('is bound to the MCP endpoint when it asks for an agent scope and names no resource', async () => {
    const { sql } = fakeSql({});
    const request = authorize({
      client_id: 'agent-client',
      scope: 'tale:mcp offline_access',
      response_type: 'code',
    });
    const bound = await authorizePrecheck(request, { sql, options: OPTIONS });
    expect(new URL(bound.url).searchParams.get('resource')).toBe(
      'https://tale.example.com/api/v1/mcp',
    );
    expect(new URL(bound.url).searchParams.get('scope')).toBe(
      'tale:mcp offline_access',
    );
  });

  it('is bound when its client is a metadata document or a registered agent client', async () => {
    const { sql, queries } = fakeSql({ agentClients: ['registered-agent'] });
    const document = await authorizePrecheck(
      authorize({
        client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
      }),
      { sql, options: OPTIONS },
    );
    expect(new URL(document.url).searchParams.get('resource')).toBe(
      'https://tale.example.com/api/v1/mcp',
    );
    expect(queries).toEqual([]);
    const registeredAgent = await authorizePrecheck(
      authorize({ client_id: 'registered-agent' }),
      { sql, options: OPTIONS },
    );
    expect(new URL(registeredAgent.url).searchParams.get('resource')).toBe(
      'https://tale.example.com/api/v1/mcp',
    );
  });

  it('leaves single sign-on, a named resource and a request by reference exactly as they came', async () => {
    const { sql } = fakeSql({ agentClients: [] });
    const queries: Record<string, string>[] = [
      {
        client_id: 'identity-client',
        scope: 'openid profile email tale:organization',
      },
      {
        client_id: 'agent-client',
        scope: 'tale:mcp',
        resource: 'https://tale.example.com/api/v1/mcp',
      },
      { client_id: 'agent-client', request_uri: 'urn:x' },
    ];
    for (const query of queries) {
      const request = authorize(query);
      expect(await authorizePrecheck(request, { sql, options: OPTIONS })).toBe(
        request,
      );
    }
  });

  it('binds a form-posted authorization request the same way', async () => {
    const { sql } = fakeSql({});
    const request = new Request(
      'http://backend-api:3005/api/auth/oauth2/authorize',
      {
        method: 'POST',
        headers: {
          host: 'tale.example.com',
          'x-forwarded-proto': 'https',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'client_id=agent&scope=tale%3Amcp',
      },
    );
    const bound = await authorizePrecheck(request, { sql, options: OPTIONS });
    expect(new URLSearchParams(await bound.text()).get('resource')).toBe(
      'https://tale.example.com/api/v1/mcp',
    );
  });
});

describe('a failed token request', () => {
  it('is charged to its source after the answer, and a success costs nothing', async () => {
    const { sql } = fakeSql({});
    const ok = new Response('{}', { status: 200 });
    expect(await chargeTokenFailure(sql, clientIp, ok)).toBe(ok);
    expect(checkIpRateLimit).not.toHaveBeenCalled();
    const failed = Response.json({ error: 'invalid_grant' }, { status: 400 });
    expect(await chargeTokenFailure(sql, clientIp, failed)).toBe(failed);
    expect(checkIpRateLimit).toHaveBeenCalledWith(
      sql,
      'oauth:token-fail-ip',
      '203.0.113.9',
    );
  });

  it('is answered 429 once its source failed past the budget', async () => {
    const { sql } = fakeSql({});
    vi.mocked(checkIpRateLimit).mockRejectedValueOnce(
      new RateLimitExceededError('over', 3_000),
    );
    const answer = await chargeTokenFailure(
      sql,
      clientIp,
      Response.json({ error: 'invalid_client' }, { status: 401 }),
    );
    expect(answer.status).toBe(429);
    expect(answer.headers.get('retry-after')).toBe('3');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(await answer.json()).toEqual({
      error: 'temporarily_unavailable',
      error_description:
        'too many failed token requests from this address; retry in 3 s',
    });
  });
});

describe('the agent sign-in steps at the auth mount', () => {
  it('checks registration and authorization before the provider, charges a failed token request after it, and passes the rest as they came', async () => {
    const { sql } = fakeSql({});
    const seen: Request[] = [];
    const handle = (request: Request) => {
      seen.push(request);
      return Promise.resolve(
        new URL(request.url).pathname === '/api/auth/oauth2/token'
          ? Response.json({ error: 'invalid_grant' }, { status: 400 })
          : new Response('ok'),
      );
    };
    const deps = {
      sql,
      clientIp,
      options: OPTIONS,
      session: () => Promise.resolve(null),
    };
    const refused = await withAgentOAuth(
      registration({ redirect_uris: ['https://evil.example/cb'] }),
      deps,
      handle,
    );
    expect(refused.status).toBe(400);
    expect(seen).toEqual([]);
    await withAgentOAuth(
      new Request(
        `${SITE}/api/auth/oauth2/authorize?client_id=a&scope=tale%3Amcp`,
      ),
      deps,
      handle,
    );
    expect(new URL(seen[0]?.url ?? '').searchParams.get('resource')).toBe(
      'https://tale.example.com/api/v1/mcp',
    );
    await withAgentOAuth(
      new Request(`${SITE}/api/auth/oauth2/token`, {
        method: 'POST',
        body: 'grant_type=refresh_token',
      }),
      deps,
      handle,
    );
    expect(checkIpRateLimit).toHaveBeenCalledWith(
      sql,
      'oauth:token-fail-ip',
      '203.0.113.9',
    );
    const session = new Request(`${SITE}/api/auth/get-session`);
    await withAgentOAuth(session, deps, handle);
    expect(seen.at(-1)).toBe(session);
  });
});
describe('a refresh the provider refused as an ineligible identity [AGCONN-R7]', () => {
  const ineligible = () =>
    Response.json({ message: 'IDENTITY_NOT_ELIGIBLE' }, { status: 403 });
  const run = (
    body: string,
    contentType: string,
    answer: () => Response = ineligible,
  ) => {
    const { sql } = fakeSql({});
    return withAgentOAuth(
      new Request(`${SITE}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      }),
      {
        sql,
        clientIp,
        options: OPTIONS,
        session: () => Promise.resolve(null),
      },
      () => Promise.resolve(answer()),
    );
  };

  it.each([
    [
      'a form',
      'grant_type=refresh_token&refresh_token=r',
      'application/x-www-form-urlencoded',
    ],
    [
      'JSON',
      JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'r' }),
      'application/json',
    ],
  ])(
    'is answered as an invalid grant, whether it came as %s',
    async (_form, body, type) => {
      const answered = await run(body, type);
      expect(answered.status).toBe(400);
      expect(answered.headers.get('cache-control')).toBe('no-store');
      expect(await answered.json()).toEqual({
        error: 'invalid_grant',
        error_description:
          'the person can no longer use the organization this connection was made for',
      });
    },
  );

  it('keeps the refusal of a code exchange as it was', async () => {
    const answered = await run(
      'grant_type=authorization_code&code=c',
      'application/x-www-form-urlencoded',
    );
    expect(answered.status).toBe(403);
    expect(await answered.json()).toEqual({ message: 'IDENTITY_NOT_ELIGIBLE' });
  });

  it.each([
    [
      'another refusal',
      () => Response.json({ message: 'FORBIDDEN' }, { status: 403 }),
    ],
    ['an answer that is not JSON', () => new Response('no', { status: 403 })],
    [
      'another status',
      () =>
        Response.json({ message: 'IDENTITY_NOT_ELIGIBLE' }, { status: 401 }),
    ],
  ])('keeps %s as it was', async (_what, answer) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answered = await run(
      'grant_type=refresh_token&refresh_token=r',
      'application/x-www-form-urlencoded',
      answer,
    );
    expect(answered.status).not.toBe(400);
    warn.mockRestore();
  });

  it('reads no grant from a body that is not what its media type says', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answered = await run('{oops', 'application/json');
    expect(answered.status).toBe(403);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a refresh token used twice at the auth mount [AGCONN-R16]', () => {
  const REUSED = {
    id: 'rt-1',
    userId: 'user-ada',
    clientId: 'https://claude.example.test/client.json',
  };
  const refreshRequest = () =>
    new Request(`${SITE}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'an-old-token',
        client_id: REUSED.clientId,
      }).toString(),
    });

  /** The token table as the steps read it: the used token the request
   * presents (when it is one), and which tokens are still on file. */
  function tokens(options: { used: boolean; onFile: () => boolean }) {
    const events: string[] = [];
    const tag = (strings: TemplateStringsArray) => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT "id", "userId", "clientId" FROM')) {
        events.push('lookup');
        return Promise.resolve(options.used ? [REUSED] : []);
      }
      if (text.startsWith('SELECT "id" FROM "oauthRefreshToken"')) {
        events.push('check');
        return Promise.resolve(options.onFile() ? [{ id: REUSED.id }] : []);
      }
      return Promise.reject(new Error(`unexpected query: ${text}`));
    };
    const sql = Object.assign(tag, {
      begin: (work: (tx: unknown) => Promise<unknown>) => work(sql),
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
    return { sql: sql as unknown as Sql, events };
  }

  const refused = () =>
    Response.json(
      { error: 'invalid_grant', error_description: 'invalid refresh token' },
      { status: 400 },
    );

  async function run(
    sql: Sql,
    events: string[],
    answer: () => Response,
    onProvider: () => void = () => {},
  ) {
    return withAgentOAuth(
      refreshRequest(),
      { sql, clientIp, options: OPTIONS, session: () => Promise.resolve(null) },
      () => {
        events.push('provider');
        onProvider();
        return Promise.resolve(answer());
      },
    );
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(endAgentConnectionsAndTellInTx).mockClear();
  });

  it('ends the connections of the person and the app once the provider ended their sign-in, and leaves its answer as it was', async () => {
    let onFile = true;
    const { sql, events } = tokens({ used: true, onFile: () => onFile });
    const answered = await run(sql, events, refused, () => {
      // The provider ends every refresh token of the app for the person.
      onFile = false;
    });
    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'invalid refresh token',
    });
    // The token is read before the provider takes it from its table.
    expect(events).toEqual(['lookup', 'provider', 'check']);
    expect(endAgentConnectionsAndTellInTx).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(endAgentConnectionsAndTellInTx).mock.calls[0]?.[1],
    ).toEqual({
      userId: REUSED.userId,
      clientId: REUSED.clientId,
      reason: 'refresh_reuse',
      revokedBy: 'system',
    });
    // The failed request is still charged to its source.
    expect(checkIpRateLimit).toHaveBeenCalledWith(
      sql,
      'oauth:token-fail-ip',
      '203.0.113.9',
    );
  });

  it('ends nothing when the provider refused for another reason and left the token on file', async () => {
    const { sql, events } = tokens({ used: true, onFile: () => true });
    expect((await run(sql, events, refused)).status).toBe(400);
    expect(events).toEqual(['lookup', 'provider', 'check']);
    expect(endAgentConnectionsAndTellInTx).not.toHaveBeenCalled();
  });

  it('ends nothing when the provider answered, even if the token it presented was a used one: a retry is answered the same', async () => {
    const { sql, events } = tokens({ used: true, onFile: () => false });
    const answered = await run(sql, events, () =>
      Response.json({ access_token: 'a', refresh_token: 'b' }),
    );
    expect(answered.status).toBe(200);
    expect(events).toEqual(['lookup', 'provider']);
    expect(endAgentConnectionsAndTellInTx).not.toHaveBeenCalled();
  });

  it('ends nothing, and asks nothing more, for a refusal of a token that is not a used one', async () => {
    const { sql, events } = tokens({ used: false, onFile: () => false });
    expect((await run(sql, events, refused)).status).toBe(400);
    expect(events).toEqual(['lookup', 'provider']);
    expect(endAgentConnectionsAndTellInTx).not.toHaveBeenCalled();
  });

  it('answers as the provider did when ending the connections fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(endAgentConnectionsAndTellInTx).mockRejectedValueOnce(
      new Error('lock timeout'),
    );
    const { sql, events } = tokens({ used: true, onFile: () => false });
    const answered = await run(sql, events, refused);
    expect(answered.status).toBe(400);
    expect(await answered.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('is not looked for in a request that is no refresh', async () => {
    const { sql, events } = tokens({ used: true, onFile: () => false });
    await withAgentOAuth(
      new Request(`${SITE}/api/auth/oauth2/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'c',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      { sql, clientIp, options: OPTIONS, session: () => Promise.resolve(null) },
      () => {
        events.push('provider');
        return Promise.resolve(refused());
      },
    );
    expect(events).toEqual(['provider']);
  });
});
