// @vitest-environment node

/**
 * The Slack Events endpoint, driven end to end through the registered route
 * table (`t.fetch` → `convex/http.ts`).
 *
 * The suite is written to fail for the mistakes that make an inbound webhook
 * dangerous rather than merely broken: processing before verifying, verifying a
 * re-serialized body, accepting a replayed delivery, and answering for a
 * workspace no organization has connected.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'http_integrations';
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

const SIGNING_SECRET = 'slack-signing-secret-for-tests-0001';
const EVENTS_PATH = '/api/integrations/slack/events';
const ORG = 'org_slack_events';
const OTHER_ORG = 'org_slack_other';
const TEAM = 'T0EVENTS01';

function newWorld(): TestConvex<typeof schema> {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

/** Sign exactly as Slack does, over the raw body text. */
async function sign(rawBody: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `v0=${hex}`;
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

async function post(
  t: TestConvex<typeof schema>,
  rawBody: string,
  options: { timestamp?: string; signature?: string } = {},
): Promise<Response> {
  const timestamp = options.timestamp ?? nowSeconds();
  const signature = options.signature ?? (await sign(rawBody, timestamp));
  return t.fetch(EVENTS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
    },
    body: rawBody,
  });
}

async function seedRoute(
  t: TestConvex<typeof schema>,
  organizationId: string,
  teamId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('slackTeamRoutes', {
      organizationId,
      teamId,
      credentialId: `credential_${organizationId}`,
      createdAt: Date.now(),
    });
  });
}

const EVENT_BODY = JSON.stringify({
  type: 'event_callback',
  team_id: TEAM,
  event_id: 'Ev0EVENT01',
  event: { type: 'app_mention', text: 'hello', user: 'U01', channel: 'C01' },
});

describe('Slack Events endpoint', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.stubEnv('INTEGRATION_SLACK_SIGNING_SECRET', SIGNING_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('echoes the challenge of a signed url_verification handshake', async () => {
    const t = newWorld();
    const body = JSON.stringify({
      type: 'url_verification',
      challenge: 'challenge-token-abc',
    });

    const res = await post(t, body);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      challenge: 'challenge-token-abc',
    });
  });

  it('rejects an unsigned request without processing it', async () => {
    const t = newWorld();
    await seedRoute(t, ORG, TEAM);

    const res = await t.fetch(EVENTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: EVENT_BODY,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a delivery signed with the wrong secret', async () => {
    const t = newWorld();
    await seedRoute(t, ORG, TEAM);
    const timestamp = nowSeconds();

    const res = await post(t, EVENT_BODY, {
      timestamp,
      // A structurally valid v0 signature made by someone else.
      signature: `v0=${'ab'.repeat(32)}`,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a correctly signed delivery whose timestamp is stale', async () => {
    const t = newWorld();
    await seedRoute(t, ORG, TEAM);
    const stale = String(Math.floor(Date.now() / 1000) - 600);

    const res = await post(t, EVENT_BODY, { timestamp: stale });

    expect(res.status).toBe(401);
  });

  it('rejects a challenge whose signature covers a re-serialized body', async () => {
    const t = newWorld();
    // Slack sends these bytes; a handler that parsed first and signed
    // `JSON.stringify(parsed)` would compute the second signature and accept.
    const rawBody =
      '{\n  "challenge": "challenge-token-raw",\n  "type": "url_verification"\n}';
    const reserialized = JSON.stringify(JSON.parse(rawBody));
    expect(reserialized).not.toBe(rawBody);

    const timestamp = nowSeconds();
    const res = await post(t, rawBody, {
      timestamp,
      signature: await sign(reserialized, timestamp),
    });

    expect(res.status).toBe(401);
  });

  it('accepts a challenge signed over an unusual raw spelling', async () => {
    const t = newWorld();
    const rawBody =
      '{\n  "challenge": "challenge-token-raw",\n  "type": "url_verification"\n}';

    const res = await post(t, rawBody);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      challenge: 'challenge-token-raw',
    });
  });

  it('refuses a workspace no organization has connected', async () => {
    const t = newWorld();
    await seedRoute(t, ORG, 'T0SOMEONEELSE');

    const res = await post(t, EVENT_BODY);

    expect(res.status).toBe(404);
    // Nothing was queued for anyone.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(scheduled).toHaveLength(0);
  });

  it('routes a known workspace to exactly one organization', async () => {
    const t = newWorld();
    await seedRoute(t, ORG, TEAM);
    await seedRoute(t, OTHER_ORG, 'T0OTHERTEAM');

    const res = await post(t, EVENT_BODY);

    expect(res.status).toBe(200);
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(scheduled).toHaveLength(1);
    const args = scheduled[0].args[0] as {
      organizationId: string;
      teamId: string;
      credentialId: string;
      eventType?: string;
    };
    expect(args.organizationId).toBe(ORG);
    expect(args.teamId).toBe(TEAM);
    expect(args.credentialId).toBe(`credential_${ORG}`);
    expect(args.eventType).toBe('app_mention');
  });

  it('refuses to route a workspace claimed by two organizations', async () => {
    const t = newWorld();
    await seedRoute(t, ORG, TEAM);
    await seedRoute(t, OTHER_ORG, TEAM);

    const res = await post(t, EVENT_BODY);

    expect(res.status).toBe(404);
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(scheduled).toHaveLength(0);
  });

  it('stays shut when the deployment has no signing secret', async () => {
    vi.stubEnv('INTEGRATION_SLACK_SIGNING_SECRET', '');
    const t = newWorld();
    await seedRoute(t, ORG, TEAM);

    const res = await post(t, EVENT_BODY);

    expect(res.status).toBe(503);
  });
});
