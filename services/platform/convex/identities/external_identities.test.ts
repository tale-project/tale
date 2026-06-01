import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { buildExternalOwnerId, isExternalOwnerId } from './external_identities';

describe('external owner ids', () => {
  it('builds an org-scoped namespaced owner id', () => {
    expect(buildExternalOwnerId('slack', 'U07ABC123', 'org_42')).toBe(
      'slack:org_42:U07ABC123',
    );
  });

  it('produces distinct owner ids for the same external user in different orgs', () => {
    // The org segment guarantees cross-org isolation of identity rows.
    expect(buildExternalOwnerId('slack', 'U07ABC123', 'org_a')).not.toBe(
      buildExternalOwnerId('slack', 'U07ABC123', 'org_b'),
    );
  });

  it('treats the system sentinel and namespaced ids as external', () => {
    expect(isExternalOwnerId('system')).toBe(true);
    expect(isExternalOwnerId('slack:org_42:U07ABC123')).toBe(true);
  });

  it('treats plain Better Auth ids as internal', () => {
    // Convex/Better Auth ids never contain a separator.
    expect(isExternalOwnerId('k1739f3c8x2abcd1234567890')).toBe(false);
  });
});

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/identities/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'identities';
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

describe('externalIdentities upsert/lookup', () => {
  it('isolates the same Slack user across orgs (no cross-org name bleed)', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.identities.external_identities.upsertExternalIdentity,
      {
        source: 'slack',
        organizationId: 'org_a',
        externalUserId: 'U1',
        displayName: 'Alice',
      },
    );
    await t.mutation(
      internal.identities.external_identities.upsertExternalIdentity,
      {
        source: 'slack',
        organizationId: 'org_b',
        externalUserId: 'U1',
        displayName: 'Bob',
      },
    );

    const a = await t.query(
      internal.identities.external_identities.getByOwnerId,
      { ownerId: buildExternalOwnerId('slack', 'U1', 'org_a') },
    );
    const b = await t.query(
      internal.identities.external_identities.getByOwnerId,
      { ownerId: buildExternalOwnerId('slack', 'U1', 'org_b') },
    );
    expect(a?.displayName).toBe('Alice');
    expect(b?.displayName).toBe('Bob');

    const rows = await t.run(async (ctx) =>
      ctx.db.query('externalIdentities').collect(),
    );
    expect(rows).toHaveLength(2);
  });

  it('patches in place on re-upsert and preserves the name when none is fetched', async () => {
    const t = convexTest(schema, modules);
    const args = {
      source: 'slack' as const,
      organizationId: 'org_a',
      externalUserId: 'U2',
    };

    await t.mutation(
      internal.identities.external_identities.upsertExternalIdentity,
      { ...args, displayName: 'First' },
    );
    await t.mutation(
      internal.identities.external_identities.upsertExternalIdentity,
      { ...args, displayName: 'Second' },
    );
    // No displayName fetched this round: must preserve the existing name AND
    // leave updatedAt untouched (so a failed refresh keeps retrying).
    const before = await t.run(async (ctx) =>
      ctx.db
        .query('externalIdentities')
        .withIndex('by_ownerId', (q) =>
          q.eq('ownerId', buildExternalOwnerId('slack', 'U2', 'org_a')),
        )
        .first(),
    );
    await t.mutation(
      internal.identities.external_identities.upsertExternalIdentity,
      args,
    );
    const after = await t.run(async (ctx) =>
      ctx.db
        .query('externalIdentities')
        .withIndex('by_ownerId', (q) =>
          q.eq('ownerId', buildExternalOwnerId('slack', 'U2', 'org_a')),
        )
        .first(),
    );

    const rows = await t.run(async (ctx) =>
      ctx.db.query('externalIdentities').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(after?.displayName).toBe('Second');
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});
