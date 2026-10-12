// @vitest-environment node

/**
 * The part of the REST door that admits a coding agent signed in to the MCP
 * endpoint [AGCONN-R11, AGCONN-R12, AGCONN-R14]: the token is proved first,
 * then the connection behind it, then the person's seat; the call acts in the
 * organization the connection was made for.
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

import type { AgentConnectionSeat } from '../domains/agent_connections/seat.ts';
import { RateLimitExceededError } from '../lib/rate-limit.ts';
import { admitAgentBearer, isMcpRoute } from './agent-door.ts';
import type { RestEnv } from './shared.ts';

const limits = vi.hoisted(() => ({
  checkIpRateLimit: vi.fn(),
  checkUserRateLimit: vi.fn(),
}));
vi.mock('../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/rate-limit.ts')>()),
  ...limits,
}));

const seatOf = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('../domains/agent_connections/seat.ts', () => ({
  findLiveConnectionSeat: seatOf.find,
}));

const SITE = 'https://tale.example.test';
const ISSUER = `${SITE}/api/auth`;
const MCP = `${SITE}/api/v1/mcp`;
const CLIENT = 'https://claude.example.test/client.json';
const ORGANIZATION = 'https://tale.dev/organization';
const NOW = Math.floor(Date.now() / 1000);

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
  limits.checkIpRateLimit.mockReset().mockResolvedValue(undefined);
  limits.checkUserRateLimit.mockReset().mockResolvedValue(undefined);
  seatOf.find.mockReset().mockResolvedValue(SEAT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// A connection keeps the access its person allowed; staying connected is no
// access and is not among them.
const SEAT: AgentConnectionSeat = {
  connectionId: 'conn-1',
  clientName: 'Claude Code',
  scopes: ['tale:mcp', 'tale:automations.write'],
  createdAt: NOW * 1000 - 60_000,
  organizationSlug: 'acme',
  role: 'developer',
  email: 'ada@example.test',
};

async function token(
  options: {
    iat?: number;
    exp?: number;
    claims?: Record<string, unknown>;
  } = {},
): Promise<string> {
  return new SignJWT({
    sub: 'user-ada',
    azp: CLIENT,
    scope: 'tale:mcp tale:automations.write offline_access',
    [ORGANIZATION]: { id: 'org-acme', slug: 'acme', role: 'owner' },
    ...options.claims,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'kid-1' })
    .setIssuer(ISSUER)
    .setAudience(MCP)
    .setIssuedAt(options.iat ?? NOW)
    .setExpirationTime(options.exp ?? NOW + 300)
    .sign(signer);
}

/** The door's agent step, ahead of a probe that answers what it set. */
function door(
  jwks: () => Promise<JSONWebKeySet | undefined> = async () => keys,
) {
  // Each door keeps its own keys, as each real door does.
  const keyCache = {};
  const app = new Hono<RestEnv>();
  app.onError((error) =>
    Response.json({ thrown: String(error) }, { status: 500 }),
  );
  app.post('/api/v1/mcp', async (c) => {
    const refused = await admitAgentBearer(
      c,
      c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
      '203.0.113.7',
      { sql: {} as Sql, jwks, issuer: ISSUER, keyCache },
    );
    if (refused !== null) return refused;
    const connection = c.get('agentConnection');
    return c.json({
      userId: c.get('userId'),
      userEmail: c.get('userEmail'),
      organizationId: c.get('organizationId'),
      orgSlug: c.get('orgSlug'),
      role: c.get('role'),
      orgExplicit: c.get('orgExplicit'),
      apiKeyId: c.get('apiKeyId'),
      apiKeyOwner: c.get('apiKeyOwner'),
      clientIp: c.get('clientIp'),
      connection:
        connection === undefined
          ? null
          : { ...connection, scopes: [...connection.scopes].sort() },
    });
  });
  return (value: string, headers: Record<string, string> = {}) =>
    app.request(`${SITE}/api/v1/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${value}`, ...headers },
    });
}

describe('an agent whose connection is live [AGCONN-R11]', () => {
  it('acts as its person in the organization the connection was made for, with their role now', async () => {
    const response = await door()(await token());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: 'user-ada',
      userEmail: 'ada@example.test',
      organizationId: 'org-acme',
      orgSlug: 'acme',
      // The role is the seat's now, not the one the token was issued with.
      role: 'developer',
      orgExplicit: true,
      apiKeyId: '',
      apiKeyOwner: null,
      clientIp: '203.0.113.7',
      connection: {
        connectionId: 'conn-1',
        clientId: CLIENT,
        clientName: 'Claude Code',
        scopes: ['offline_access', 'tale:automations.write', 'tale:mcp'],
      },
    });
    expect(seatOf.find).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-acme',
      userId: 'user-ada',
      clientId: CLIENT,
    });
  });

  it('is charged to its person’s request budget, the one their keys draw from', async () => {
    await door()(await token());
    expect(limits.checkUserRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'rest:api',
      'user-ada',
    );
    expect(limits.checkIpRateLimit).not.toHaveBeenCalled();
  });

  it('holds what the token carries that the connection still holds: allowing less takes effect at once, allowing more with the next token', async () => {
    seatOf.find.mockResolvedValue({ ...SEAT, scopes: ['tale:mcp'] });
    const narrowed = await (await door()(await token())).json();
    // Staying connected is no access, so it stays; the edit access is gone.
    expect(narrowed.connection.scopes).toEqual(['offline_access', 'tale:mcp']);
    seatOf.find.mockResolvedValue({
      ...SEAT,
      scopes: [...SEAT.scopes, 'tale:automations.deploy'],
    });
    const same = await (await door()(await token())).json();
    expect(same.connection.scopes).toEqual([
      'offline_access',
      'tale:automations.write',
      'tale:mcp',
    ]);
  });

  it('keeps the sign-in server’s keys between calls instead of asking for them each time', async () => {
    const jwks = vi.fn(() => Promise.resolve(keys));
    const call = door(jwks);
    expect((await call(await token())).status).toBe(200);
    expect((await call(await token())).status).toBe(200);
    expect(jwks).toHaveBeenCalledTimes(1);
  });

  it('is refused once the connection ended, the person left the organization or the seat was switched off', async () => {
    seatOf.find.mockResolvedValue(null);
    const response = await door()(await token());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'This connection has ended; connect the agent again',
      code: 'UNAUTHORIZED',
    });
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", error_description="This connection has ended; connect the agent again", resource_metadata="${SITE}/.well-known/oauth-protected-resource/api/v1/mcp", scope="tale:mcp tale:automations.write tale:automations.deploy tale:settings.read tale:settings.write tale:subscriptions.connect offline_access"`,
    );
  });

  it('is refused a token minted before the connection was made: it belongs to an earlier connection of the same app', async () => {
    seatOf.find.mockResolvedValue({
      ...SEAT,
      createdAt: NOW * 1000 + 60_000,
    });
    expect((await door()(await token())).status).toBe(401);
    // A moment's skew between the instances that issued and recorded is not
    // an earlier connection.
    seatOf.find.mockResolvedValue({ ...SEAT, createdAt: NOW * 1000 + 4_000 });
    expect((await door()(await token())).status).toBe(200);
    seatOf.find.mockResolvedValue({ ...SEAT, createdAt: NOW * 1000 + 6_000 });
    expect((await door()(await token())).status).toBe(401);
  });

  it('reads nothing of the connection for a token that is not good', async () => {
    await door()(await token({ iat: NOW - 600, exp: NOW - 300 }));
    expect(seatOf.find).not.toHaveBeenCalled();
    expect(limits.checkUserRateLimit).not.toHaveBeenCalled();
  });
});

describe('an agent that names another organization [AGCONN-R12]', () => {
  it('is refused with the organization the connection is for, and nothing of what it asked for', async () => {
    const response = await door()(await token(), {
      'x-organization-slug': 'Beta<script>',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        'This agent connection is for "acme" and cannot act in another organization. Connect the agent again to use a different one.',
      code: 'ORG_MISMATCH',
      data: { organization: 'acme' },
    });
    expect(response.headers.get('www-authenticate')).toBeNull();
    // The organization looked up is the token's, never the one asked for.
    expect(seatOf.find).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-acme',
      userId: 'user-ada',
      clientId: CLIENT,
    });
  });

  it('acts in its own when it names it, in any case, or names nothing', async () => {
    const asks: Record<string, string>[] = [
      { 'x-organization-slug': 'acme' },
      { 'x-organization-slug': ' ACME ' },
      { 'x-organization-slug': '' },
      {},
    ];
    for (const headers of asks) {
      const response = await door()(await token(), headers);
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect((await response.json()).organizationId).toBe('org-acme');
    }
  });
});

describe('an agent told where to sign in [AGCONN-R14]', () => {
  it('is refused a token that ran out with the reason, and is not counted against its source', async () => {
    const response = await door()(
      await token({ iat: NOW - 600, exp: NOW - 300 }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'error="invalid_token", error_description="The access token has expired", resource_metadata="',
    );
    expect(limits.checkIpRateLimit).not.toHaveBeenCalled();
  });

  it('is refused a token that was never good, and counted against its source like a wrong key', async () => {
    const response = await door()('a.b.c');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'The access token is not valid for this endpoint',
      code: 'UNAUTHORIZED',
    });
    expect(limits.checkIpRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'rest:auth-fail-ip',
      '203.0.113.7',
    );
  });

  it('is told to wait when the source has failed too often, before it is told the token is wrong', async () => {
    limits.checkIpRateLimit.mockRejectedValue(
      new RateLimitExceededError('too many failures', 30_000),
    );
    const response = await door()('a.b.c');
    expect(response.status).toBe(429);
  });

  it('is told to wait when its person has spent the request budget, before the connection is read', async () => {
    limits.checkUserRateLimit.mockRejectedValue(
      new RateLimitExceededError('too many requests', 12_000),
    );
    const response = await door()(await token());
    expect(response.status).toBe(429);
    expect(seatOf.find).not.toHaveBeenCalled();
  });

  it('meets an outage as an outage: a database that cannot give the keys is not a wrong token', async () => {
    const response = await door(() => Promise.reject(new Error('refused')))(
      await token(),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ thrown: 'Error: refused' });
    expect(limits.checkIpRateLimit).not.toHaveBeenCalled();
  });
});

describe('the one route an agent’s token opens', () => {
  it('is the MCP endpoint, exactly', () => {
    expect(isMcpRoute('/api/v1/mcp')).toBe(true);
    for (const path of [
      '/api/v1/mcp/',
      '/api/v1/MCP',
      '/api/v1/mcp/x',
      '/api/v1/automations',
      '/mcp',
      '',
    ]) {
      expect(isMcpRoute(path), path).toBe(false);
    }
  });
});
