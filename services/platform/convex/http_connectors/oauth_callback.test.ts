// @vitest-environment node

/**
 * The `callback` half of the OAuth2 flow, driven end to end through the
 * registered route table (`t.fetch` → `convex/http.ts`) against a real Convex
 * world, with the vendor's token endpoint stubbed — no network is touched.
 *
 * The credentials domain is reached through the seam declared in
 * `credential_seam.ts`. The module map below substitutes a recording stand-in
 * at that path, so the test asserts the CONTRACT the callback depends on (one
 * store call, for the organization the state was minted for) and stays green
 * whatever the domain does with it internally.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internalAction, internalMutation } from '../_generated/server';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';
import { hashStateToken } from './oauth_state';

const TEST_DIR_FROM_CONVEX_ROOT = 'http_connectors';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const SITE_URL = 'https://tale.example';
const EXPECTED_REDIRECT_URI = `${SITE_URL}/api/connectors/oauth2/callback`;
const SETTINGS_PATH = '/dashboard/org_cb_test/settings/connectors';
const ORG = 'org_cb_test';
const OTHER_ORG = 'org_cb_other';
const USER = 'user_cb_test';
const CALLBACK_PATH = '/api/connectors/oauth2/callback';

const ACCESS_TOKEN = 'xoxb-super-secret-access-token';
const REFRESH_TOKEN = 'xoxe-super-secret-refresh-token';
const TEAM = 'T0CALLBACK1';

/** Every store call the callback made, in order. */
const storeCalls: Array<Record<string, unknown>> = [];

const insertFixtureCredentialRef = makeFunctionReference<
  'mutation',
  {
    organizationId: string;
    connectorSlug: string;
    name: string;
    createdBy: string;
  },
  string
>('connector_credentials/actions:insertFixtureCredential');

/**
 * Stand-in for the credentials domain. Records the call and writes a row into
 * the REAL `connectorCredentials` table, so "exactly one credential, scoped
 * to the right organization" is asserted against schema-validated state rather
 * than against a spy alone. The ciphertext is a fixture: encryption is the
 * domain's business, and nothing here may see a plaintext token again.
 */
const insertFixtureCredential = internalMutation({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    name: v.string(),
    createdBy: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert('connectorCredentials', {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      authMethod: 'oauth2',
      name: args.name,
      encryptedData: {
        ciphertext: 'ct-fixture',
        nonce: 'nonce-fixture',
        authTag: 'tag-fixture',
        keyFingerprint: 'fp-fixture',
      },
      isDefault: true,
      status: 'active',
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

const storeOauth2Credential = internalAction({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    createdBy: v.string(),
    name: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
  },
  returns: v.object({ credentialId: v.string() }),
  handler: async (ctx, args) => {
    storeCalls.push({ ...args });
    const credentialId: string = await ctx.runMutation(
      insertFixtureCredentialRef,
      {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        name: args.name,
        createdBy: args.createdBy,
      },
    );
    return { credentialId };
  },
});

// Substituted AFTER the glob so it wins over whatever the domain ships.
modules['connector_credentials/actions.ts'] = () =>
  Promise.resolve({ storeOauth2Credential, insertFixtureCredential });

function newWorld(): TestConvex<typeof schema> {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

interface PendingOverrides {
  organizationId?: string;
  connectorSlug?: string;
  expiresAt?: number;
}

/** Mint a pending authorization exactly as `start` would, returning its token. */
async function seedPending(
  t: TestConvex<typeof schema>,
  overrides: PendingOverrides = {},
): Promise<string> {
  const state = `state-token-${Math.random().toString(36).slice(2)}`;
  const stateHash = await hashStateToken(state);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert('connectorOauthStates', {
      stateHash,
      organizationId: overrides.organizationId ?? ORG,
      userId: USER,
      connectorSlug: overrides.connectorSlug ?? 'slack',
      codeVerifier: 'test-code-verifier-0123456789',
      redirectUri: EXPECTED_REDIRECT_URI,
      createdAt: now,
      expiresAt: overrides.expiresAt ?? now + 600_000,
    });
  });
  return state;
}

function callbackUrl(params: Record<string, string>): string {
  const url = new URL(`${SITE_URL}${CALLBACK_PATH}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

/** A Slack-shaped success body for the token endpoint. */
function slackTokenResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 43_200,
      scope: 'chat:write,channels:read',
      team: { id: TEAM, name: 'Test Workspace' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function stubTokenEndpoint(
  response: () => Response | Promise<Response>,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    // The handler always passes a string URL; anything else is a test bug.
    const url = typeof input === 'string' ? input : '<non-string request>';
    if (!url.startsWith('https://slack.com/api/oauth.v2.access')) {
      throw new Error(`unexpected outbound request to ${url}`);
    }
    return response();
  });
}

async function credentialsOf(
  t: TestConvex<typeof schema>,
): Promise<Array<{ organizationId: string; connectorSlug: string }>> {
  // The table transitionally admits retired rows too, so `connectorSlug` is
  // optional on the stored shape; a credential this flow wrote always carries
  // one, and anything without it is not what these assertions are about.
  const rows = await t.run(async (ctx) =>
    ctx.db.query('connectorCredentials').collect(),
  );
  return rows.flatMap((row) =>
    row.connectorSlug === undefined
      ? []
      : [
          {
            organizationId: row.organizationId,
            connectorSlug: row.connectorSlug,
          },
        ],
  );
}

describe('OAuth2 callback', { timeout: 60_000 }, () => {
  beforeEach(() => {
    storeCalls.length = 0;
    vi.stubEnv('SITE_URL', SITE_URL);
    vi.stubEnv('BASE_PATH', '');
    vi.stubEnv('CONNECTOR_OAUTH_SLACK_CLIENT_ID', 'slack-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_SLACK_CLIENT_SECRET', 'slack-client-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stores exactly one credential, scoped to the organization the state was minted for', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      `${SITE_URL}${SETTINGS_PATH}?connected=slack`,
    );

    expect(storeCalls).toHaveLength(1);
    expect(storeCalls[0]).toMatchObject({
      organizationId: ORG,
      connectorSlug: 'slack',
      createdBy: USER,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      scopes: ['chat:write', 'channels:read'],
    });
    expect(typeof storeCalls[0].expiresAt).toBe('number');

    const credentials = await credentialsOf(t);
    expect(credentials).toHaveLength(1);
    expect(credentials[0].organizationId).toBe(ORG);
    expect(credentials[0].connectorSlug).toBe('slack');

    // The exchange happened server-side, once, with the PKCE verifier.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String((fetchSpy.mock.calls[0][1] as { body: unknown }).body);
    const sent = new URLSearchParams(body);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('auth-code-1');
    expect(sent.get('code_verifier')).toBe('test-code-verifier-0123456789');
    expect(sent.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(sent.get('client_secret')).toBe('slack-client-secret');

    // No token reaches the browser: not in the redirect, not in the body.
    const responseText = await res.text();
    expect(responseText).not.toContain(ACCESS_TOKEN);
    expect(responseText).not.toContain(REFRESH_TOKEN);
    expect(res.headers.get('Location')).not.toContain(ACCESS_TOKEN);
  });

  it('claims the Slack workspace route for that organization', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    stubTokenEndpoint(slackTokenResponse);

    await t.fetch(callbackUrl({ code: 'auth-code-1', state }));

    const routes = await t.run(async (ctx) =>
      ctx.db.query('slackTeamRoutes').collect(),
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ organizationId: ORG, teamId: TEAM });

    // The route points at the credential the store call returned.
    const credential = await t.run(async (ctx) =>
      ctx.db.query('connectorCredentials').first(),
    );
    expect(routes[0].credentialId).toBe(credential?._id);
  });

  it('rejects a state that was never minted', async () => {
    const t = newWorld();
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(
      callbackUrl({ code: 'auth-code-1', state: 'not-a-real-state' }),
    );

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storeCalls).toHaveLength(0);
    expect(await credentialsOf(t)).toHaveLength(0);
  });

  it('rejects a request with no state at all', async () => {
    const t = newWorld();
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1' }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a replay of an already-consumed state', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const first = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));
    expect(first.status).toBe(302);

    const replay = await t.fetch(callbackUrl({ code: 'auth-code-2', state }));
    expect(replay.status).toBe(400);

    // The second attempt never reached the vendor and stored nothing.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storeCalls).toHaveLength(1);
    expect(await credentialsOf(t)).toHaveLength(1);
  });

  it('rejects an expired state and burns it', async () => {
    const t = newWorld();
    const state = await seedPending(t, { expiresAt: Date.now() - 1_000 });
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await credentialsOf(t)).toHaveLength(0);
    expect(
      await t.run(async (ctx) =>
        ctx.db.query('connectorOauthStates').collect(),
      ),
    ).toHaveLength(0);
  });

  it('burns the state even when the user declined consent', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const declined = await t.fetch(
      callbackUrl({ error: 'access_denied', state }),
    );
    expect(declined.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();

    // The same state cannot then be used to complete a real exchange.
    const retry = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));
    expect(retry.status).toBe(400);
    expect(storeCalls).toHaveLength(0);
  });

  it('leaks nothing from a vendor error body', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    const leakyBody = JSON.stringify({
      ok: false,
      error: 'invalid_code',
      // Vendors routinely echo request material in failures; none of it may
      // reach the page.
      access_token: ACCESS_TOKEN,
      client_secret: 'slack-client-secret',
      detail: 'code auth-code-1 was already redeemed',
    });
    stubTokenEndpoint(
      () =>
        new Response(leakyBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain('slack-client-secret');
    expect(text).not.toContain('auth-code-1');
    expect(text).not.toContain('invalid_code');
    expect(storeCalls).toHaveLength(0);
    expect(await credentialsOf(t)).toHaveLength(0);
  });

  it('reports an unreachable vendor without storing anything', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    stubTokenEndpoint(() => {
      throw new Error('connect ECONNREFUSED 1.2.3.4:443');
    });

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));

    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('ECONNREFUSED');
    expect(storeCalls).toHaveLength(0);
  });

  it('ignores a redirect_uri supplied on the callback request', async () => {
    const t = newWorld();
    const state = await seedPending(t);
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(
      callbackUrl({
        code: 'auth-code-1',
        state,
        redirect_uri: 'https://attacker.example/steal',
      }),
    );

    expect(res.status).toBe(302);
    const sent = new URLSearchParams(
      String((fetchSpy.mock.calls[0][1] as { body: unknown }).body),
    );
    expect(sent.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(res.headers.get('Location')).not.toContain('attacker.example');
  });

  it('refuses a workspace already connected to another organization', async () => {
    const t = newWorld();
    await t.run(async (ctx) => {
      await ctx.db.insert('slackTeamRoutes', {
        organizationId: OTHER_ORG,
        teamId: TEAM,
        credentialId: 'credential_other',
        createdAt: Date.now(),
      });
    });
    const state = await seedPending(t);
    stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));

    expect(res.status).toBe(409);
    // Nothing was stored, and the other organization keeps its workspace.
    expect(storeCalls).toHaveLength(0);
    expect(await credentialsOf(t)).toHaveLength(0);
    const routes = await t.run(async (ctx) =>
      ctx.db.query('slackTeamRoutes').collect(),
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].organizationId).toBe(OTHER_ORG);
    expect(routes[0].credentialId).toBe('credential_other');
  });

  it('refuses a state minted for a connector that offers no OAuth2', async () => {
    const t = newWorld();
    const state = await seedPending(t, { connectorSlug: 'github' });
    const fetchSpy = stubTokenEndpoint(slackTokenResponse);

    const res = await t.fetch(callbackUrl({ code: 'auth-code-1', state }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
