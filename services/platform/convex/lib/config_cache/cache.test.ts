import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../_generated/api';
import schema from '../../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/lib/config_cache/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'lib/config_cache';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_cfgcache';
const DOMAIN = 'governance';

type T = TestConvex<typeof schema>;

async function rows(t: T) {
  return t.run((ctx) =>
    ctx.db
      .query('configCache')
      .withIndex('by_org_domain', (q) =>
        q.eq('organizationId', ORG).eq('domain', DOMAIN),
      )
      .collect(),
  );
}

describe('replaceConfigCacheForOrg', () => {
  it('inserts rows for each entry', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 1000,
      entries: [
        { key: 'password_policy', config: { minLength: 12 }, enabled: true },
        { key: 'two_factor_policy', config: { enforced: false } },
      ],
    });
    const all = await rows(t);
    expect(all.map((r) => r.key).sort()).toEqual([
      'password_policy',
      'two_factor_policy',
    ]);
    const pw = all.find((r) => r.key === 'password_policy');
    expect(pw?.config).toEqual({ minLength: 12 });
    expect(pw?.enabled).toBe(true);
    expect(pw?.syncedAt).toBe(1000);
  });

  it('upserts existing rows (patch, not duplicate) on re-sync', async () => {
    const t = convexTest(schema, modules);
    const base = {
      organizationId: ORG,
      domain: DOMAIN,
      entries: [{ key: 'password_policy', config: { minLength: 12 } }],
    };
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      ...base,
      syncedAt: 1000,
    });
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      ...base,
      entries: [{ key: 'password_policy', config: { minLength: 16 } }],
      syncedAt: 2000,
    });
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0].config).toEqual({ minLength: 16 });
    expect(all[0].syncedAt).toBe(2000);
  });

  it('prunes rows whose key is absent from the new snapshot', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 1000,
      entries: [
        { key: 'password_policy', config: { minLength: 12 } },
        { key: 'two_factor_policy', config: { enforced: true } },
      ],
    });
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 2000,
      entries: [{ key: 'password_policy', config: { minLength: 12 } }],
    });
    const all = await rows(t);
    expect(all.map((r) => r.key)).toEqual(['password_policy']);
  });

  it('preserves effectiveAt across a re-sync that omits it', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 1000,
      entries: [
        {
          key: 'password_policy',
          config: { rotationDays: 90 },
          effectiveAt: 555,
        },
      ],
    });
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 2000,
      entries: [{ key: 'password_policy', config: { rotationDays: 90 } }],
    });
    const all = await rows(t);
    expect(all[0].effectiveAt).toBe(555);
  });

  it('does not cross domains', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: 'other_domain',
      syncedAt: 1000,
      entries: [{ key: 'k', config: { a: 1 } }],
    });
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 1000,
      entries: [{ key: 'password_policy', config: { minLength: 12 } }],
    });
    // The governance sync must not have pruned the other_domain row.
    const other = await t.run((ctx) =>
      ctx.db
        .query('configCache')
        .withIndex('by_org_domain', (q) =>
          q.eq('organizationId', ORG).eq('domain', 'other_domain'),
        )
        .collect(),
    );
    expect(other).toHaveLength(1);
  });
});

describe('setConfigCacheEffectiveAt', () => {
  it('sets then clears effectiveAt on an existing row', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.lib.config_cache.cache.replaceConfigCacheForOrg, {
      organizationId: ORG,
      domain: DOMAIN,
      syncedAt: 1000,
      entries: [{ key: 'password_policy', config: { rotationDays: 90 } }],
    });
    await t.mutation(
      internal.lib.config_cache.cache.setConfigCacheEffectiveAt,
      {
        organizationId: ORG,
        domain: DOMAIN,
        key: 'password_policy',
        effectiveAt: 777,
      },
    );
    expect((await rows(t))[0].effectiveAt).toBe(777);

    await t.mutation(
      internal.lib.config_cache.cache.setConfigCacheEffectiveAt,
      {
        organizationId: ORG,
        domain: DOMAIN,
        key: 'password_policy',
        effectiveAt: null,
      },
    );
    expect((await rows(t))[0].effectiveAt).toBeUndefined();
  });

  it('is a no-op when the row is absent', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      internal.lib.config_cache.cache.setConfigCacheEffectiveAt,
      {
        organizationId: ORG,
        domain: DOMAIN,
        key: 'missing',
        effectiveAt: 1,
      },
    );
    expect(await rows(t)).toHaveLength(0);
  });
});
