import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../schema';
import { hashScimToken } from './helpers/crypto';

/**
 * SCIM HTTP integration tests for the bearer-token security boundary and the
 * discovery endpoints. These paths resolve the org from the local
 * `ssoConnections` row and return without touching the Better Auth component,
 * so they run end-to-end under `t.fetch`. (Provisioning paths that write
 * Users/Groups go through the Better Auth component, which this repo mocks in
 * unit tests and exercises live — see the verify step in the plan.)
 */

// Build the module map keyed from the convex root (same pattern as the Slack
// http_actions test) so `t.fetch` can route to the registered http handlers.
const TEST_DIR_FROM_CONVEX_ROOT = 'scim';
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

const ORG = 'org_scim_test';
const TOKEN = 'scim_testtoken_abcdef0123456789';

async function seedConnection(
  t: ReturnType<typeof convexTest>,
  opts: { organizationId?: string; token?: string; enabled?: boolean } = {},
): Promise<void> {
  const organizationId = opts.organizationId ?? ORG;
  const token = opts.token ?? TOKEN;
  const enabled = opts.enabled ?? true;
  const tokenHash = enabled ? await hashScimToken(token) : '';
  const now = 1_700_000_000_000;
  await t.run(async (ctx) => {
    // The connection CONFIG lives in files now; this DB row holds only SCIM
    // token state (the slice these endpoints resolve the org from).
    await ctx.db.insert('ssoConnections', {
      organizationId,
      scimEnabled: enabled,
      scimTokenHash: tokenHash,
      scimTokenPrefix: enabled ? 'scim_testto…' : '',
      scimTokenGeneratedAt: enabled ? now : undefined,
      createdBy: 'user_admin',
      createdAt: now,
      updatedAt: now,
    });
  });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// Whole-tree module map + per-test token KDF make this suite boot-heavy;
// under a loaded CI worker the default 5s per-test budget is not enough
// (and the migration-chain suites' full-tree module globs load workers further).
describe('SCIM bearer-token auth', { timeout: 60_000 }, () => {
  it('rejects a request with no Authorization header (401)', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const res = await t.fetch('/scim/v2/ServiceProviderConfig', {
      method: 'GET',
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.schemas).toContain(
      'urn:ietf:params:scim:api:messages:2.0:Error',
    );
  });

  it('rejects a garbage bearer token (401)', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const res = await t.fetch('/scim/v2/ServiceProviderConfig', {
      method: 'GET',
      headers: bearer('scim_not_a_real_token'),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when SCIM is disabled even with a once-valid-looking token', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, { enabled: false });
    const res = await t.fetch('/scim/v2/ServiceProviderConfig', {
      method: 'GET',
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and stamps lastUsedAt', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const res = await t.fetch('/scim/v2/ServiceProviderConfig', {
      method: 'GET',
      headers: bearer(TOKEN),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/scim+json');
    const used = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('ssoConnections')
        .withIndex('by_org', (q) => q.eq('organizationId', ORG))
        .first();
      return row?.scimLastUsedAt;
    });
    expect(typeof used).toBe('number');
  });
});

describe('SCIM discovery endpoints', { timeout: 60_000 }, () => {
  it('serves ServiceProviderConfig advertising patch + filter support', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const res = await t.fetch('/scim/v2/ServiceProviderConfig', {
      method: 'GET',
      headers: bearer(TOKEN),
    });
    const body = await res.json();
    expect(body.schemas).toContain(
      'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
    );
    expect(body.patch.supported).toBe(true);
    expect(body.filter.supported).toBe(true);
    expect(body.bulk.supported).toBe(false);
  });

  it('serves ResourceTypes for User and Group', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const res = await t.fetch('/scim/v2/ResourceTypes', {
      method: 'GET',
      headers: bearer(TOKEN),
    });
    const body = await res.json();
    const ids = body.Resources.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['User', 'Group']));
  });

  it('serves Schemas for the core User and Group resources', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const res = await t.fetch('/scim/v2/Schemas', {
      method: 'GET',
      headers: bearer(TOKEN),
    });
    const body = await res.json();
    const ids = body.Resources.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'urn:ietf:params:scim:schemas:core:2.0:User',
        'urn:ietf:params:scim:schemas:core:2.0:Group',
      ]),
    );
  });

  it('isolates orgs: a token resolves only its own connection', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, {
      organizationId: 'org_a',
      token: 'scim_aaa_token_0001',
    });
    await seedConnection(t, {
      organizationId: 'org_b',
      token: 'scim_bbb_token_0002',
    });
    // org_a's token authenticates (200); org_b's hash never matches org_a.
    const res = await t.fetch('/scim/v2/ServiceProviderConfig', {
      method: 'GET',
      headers: bearer('scim_aaa_token_0001'),
    });
    expect(res.status).toBe(200);
    const used = await t.run(async (ctx) => {
      const a = await ctx.db
        .query('ssoConnections')
        .withIndex('by_org', (q) => q.eq('organizationId', 'org_a'))
        .first();
      const b = await ctx.db
        .query('ssoConnections')
        .withIndex('by_org', (q) => q.eq('organizationId', 'org_b'))
        .first();
      return { a: a?.scimLastUsedAt, b: b?.scimLastUsedAt };
    });
    // Only org_a's connection was touched by org_a's token.
    expect(typeof used.a).toBe('number');
    expect(used.b).toBeUndefined();
  });
});
