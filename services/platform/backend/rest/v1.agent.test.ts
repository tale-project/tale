// @vitest-environment node

/**
 * The REST door with coding agents allowed to sign in [AGCONN-R13,
 * AGCONN-R14]: a signed token opens the MCP endpoint and nothing else, only
 * when the operator lets agents in, and every refusal on the endpoint tells
 * an agent where to sign in. The agent step itself is proved in
 * `agent-door.test.ts`; this holds the door's wiring around it.
 */

import { Hono } from 'hono';
import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from 'jose';
import type { Sql } from 'postgres';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AgentOAuthOptions } from '../auth/agent-oauth-config.ts';
import type { Auth } from '../auth/auth.ts';
import { mountRestV1Routes } from './v1.ts';

vi.mock('../auth/auth.ts', () => ({
  API_KEY_RATE_LIMIT: { enabled: true, timeWindow: 60_000, maxRequests: 100 },
  loadTrustedProxies: () => Promise.resolve(['loopback', 'uniquelocal']),
}));

const SITE = 'https://tale.example.test';
const ISSUER = `${SITE}/api/auth`;
const MCP = `${SITE}/api/v1/mcp`;
const CLIENT = 'https://claude.example.test/client.json';
const NOW = Math.floor(Date.now() / 1000);
const ORGANIZATION = 'https://tale.dev/organization';

const ON: AgentOAuthOptions = {
  metadataDocuments: true,
  metadataHosts: [],
  dynamicRegistration: false,
  webRedirectHosts: [],
};
const OFF: AgentOAuthOptions = {
  metadataDocuments: false,
  metadataHosts: [],
  dynamicRegistration: false,
  webRedirectHosts: [],
};

let signer: CryptoKey;
let keys: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signer = pair.privateKey;
  keys = {
    keys: [
      { ...(await exportJWK(pair.publicKey)), kid: 'kid-1', alg: 'RS256' },
    ],
  };
});

beforeEach(() => {
  vi.stubEnv('SITE_URL', SITE);
  vi.stubEnv('BASE_PATH', '');
  vi.stubEnv('ADDITIONAL_SITE_URLS', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function token(): Promise<string> {
  return new SignJWT({
    sub: 'user-ada',
    azp: CLIENT,
    scope: 'tale:mcp offline_access',
    [ORGANIZATION]: { id: 'org-acme', slug: 'acme', role: 'developer' },
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'kid-1' })
    .setIssuer(ISSUER)
    .setAudience(MCP)
    .setIssuedAt(NOW)
    .setExpirationTime(NOW + 300)
    .sign(signer);
}

/** The database as the door meets it: a request budget with room, and the
 * one live connection of Ada’s Claude Code in Acme. */
function fakeSql(owners: Record<string, object> = {}) {
  const queries: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM app.api_key_owners WHERE api_key_id')) {
      const owner = owners[String(values[0])];
      return Promise.resolve(owner === undefined ? [] : [owner]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    if (text.includes('FROM app.agent_connections c')) {
      return Promise.resolve([
        {
          connectionId: 'conn-1',
          clientName: 'Claude Code',
          scopes: ['tale:mcp', 'offline_access'],
          createdAt: NOW * 1000 - 60_000,
          organizationSlug: 'acme',
          role: 'developer',
          email: 'ada@example.test',
        },
      ]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

const KEY = 'tale_bound_key';

function door(
  agentOAuth: AgentOAuthOptions | undefined,
  owners: Record<string, object> = {},
) {
  const { sql, queries } = fakeSql(owners);
  // `KEY` is a key the plugin knows, as user-ada's; no other value is.
  const getSession = vi.fn(({ headers }: { headers: Headers }) =>
    Promise.resolve(
      headers.get('x-api-key') === KEY
        ? { user: { id: 'user-ada' }, session: { id: 'key-1' } }
        : null,
    ),
  );
  const getJwks = vi.fn(() => Promise.resolve(keys));
  const auth = {
    api: { getSession, getJwks },
    options: { baseURL: SITE },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  } as unknown as Auth;
  const app = new Hono();
  mountRestV1Routes(app, {
    sql,
    auth,
    ...(agentOAuth === undefined ? {} : { agentOAuth }),
  });
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`${SITE}${path}`, init);
  return { request, getSession, getJwks, queries };
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18' },
});

function post(authorization?: string, body = INITIALIZE): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body,
  };
}

const METADATA = `resource_metadata="${SITE}/.well-known/oauth-protected-resource/api/v1/mcp"`;
const SCOPES =
  'scope="tale:mcp tale:automations.write tale:automations.deploy tale:settings.read tale:settings.write tale:subscriptions.connect offline_access"';

describe('a signed token on the MCP endpoint [AGCONN-R13]', () => {
  it('opens it as the connection’s person when the operator lets agents sign in, and counts the call under the connection', async () => {
    const { request, getSession, getJwks, queries } = door(ON);
    const response = await request(
      '/api/v1/mcp',
      post(`Bearer ${await token()}`),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).result.serverInfo).toBeDefined();
    expect(getSession).not.toHaveBeenCalled();
    // The sign-in server's keys are asked for once, not on every call.
    expect(
      (await request('/api/v1/mcp', post(`Bearer ${await token()}`))).status,
    ).toBe(200);
    expect(getJwks).toHaveBeenCalledTimes(1);
    const counted = queries.find((query) =>
      query.text.includes('INSERT INTO app.mcp_client_activity'),
    );
    expect(counted?.values.slice(0, 4)).toEqual([
      'org-acme',
      'user-ada',
      'oauth',
      'conn-1',
    ]);
  });

  it('is read as an API key, and refused as one, while the operator keeps agents out', async () => {
    for (const options of [undefined, OFF]) {
      const { request, getSession, getJwks } = door(options);
      const value = await token();
      const response = await request('/api/v1/mcp', post(`Bearer ${value}`));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(
        'Bearer error="invalid_token"',
      );
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(getJwks).not.toHaveBeenCalled();
    }
  });

  it('is read as an API key on every other route, and refused as one', async () => {
    const { request, getSession, getJwks } = door(ON);
    const response = await request('/api/v1/automations', {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Invalid API key',
      code: 'UNAUTHORIZED',
    });
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getJwks).not.toHaveBeenCalled();
  });

  it('leaves an API key on the endpoint to the key’s own proof', async () => {
    const { request, getSession, getJwks } = door(ON);
    const response = await request(
      '/api/v1/mcp',
      post('Bearer tale_AbCdEf0123456789'),
    );
    expect(response.status).toBe(401);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getJwks).not.toHaveBeenCalled();
  });
});

describe('every refusal on the MCP endpoint says where to sign in [AGCONN-R14]', () => {
  it('answers a request with nothing, an empty key and a wrong key with the metadata address and the scopes to ask for', async () => {
    const { request } = door(ON);
    const none = await request('/api/v1/mcp', post());
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe(
      `Bearer ${METADATA}, ${SCOPES}`,
    );
    // A value of nothing but a no-break space is empty once trimmed, and the
    // transport keeps it, unlike a plain blank.
    const empty = await request('/api/v1/mcp', post('Bearer \u00a0'));
    expect(empty.headers.get('www-authenticate')).toBe(
      `Bearer ${METADATA}, ${SCOPES}`,
    );
    const wrong = await request('/api/v1/mcp', post('Bearer tale_nope'));
    expect(wrong.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", error_description="Invalid API key", ${METADATA}, ${SCOPES}`,
    );
  });

  it('answers a method probe on the endpoint without a credential, as before', async () => {
    const { request } = door(ON);
    const response = await request('/api/v1/mcp', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('allow')).toContain('POST');
  });

  it('keeps the plain challenge on every other route, and everywhere while agents are kept out', async () => {
    const { request } = door(ON);
    const elsewhere = await request('/api/v1/automations');
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.headers.get('www-authenticate')).toBe('Bearer');
    const dark = door(OFF);
    const none = await dark.request('/api/v1/mcp', post());
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers a key bound to an organization whose binding ended with the same challenge, while agents may sign in and the plain one while they may not', async () => {
    const revoked = {
      apiKeyId: 'key-1',
      organizationId: 'org-1',
      kind: 'organization',
      keyUserId: 'user-ada',
      principalUserId: 'user-ada',
      teamId: null,
      projectId: null,
      role: 'editor',
      name: 'Billing sync',
      createdBy: 'user-olav',
      createdAt: '1',
      revokedAt: '5',
      revokedBy: 'user-olav',
    };
    const open = await door(ON, { 'key-1': revoked }).request(
      '/api/v1/mcp',
      post(`Bearer ${KEY}`),
    );
    expect(open.status).toBe(401);
    expect(open.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", error_description="Invalid API key", ${METADATA}, ${SCOPES}`,
    );
    const closed = await door(OFF, { 'key-1': revoked }).request(
      '/api/v1/mcp',
      post(`Bearer ${KEY}`),
    );
    expect(closed.status).toBe(401);
    expect(closed.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it('asks for more access with the challenge that names it when a call needs access the connection lacks [MCP-R41]', async () => {
    const { request } = door(ON);
    const response = await request(
      '/api/v1/mcp',
      post(
        `Bearer ${await token()}`,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'save_automation',
            arguments: { automation: { name: 'billing/dunning', nodes: [] } },
          },
        }),
      ),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", error_description="save_automation needs the Edit access, which this connection does not hold", ${METADATA}, scope="tale:mcp tale:automations.write offline_access"`,
    );
    expect((await response.json()).code).toBe('INSUFFICIENT_SCOPE');
  });
});
