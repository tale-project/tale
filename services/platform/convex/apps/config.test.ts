import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/apps/), mirroring tasks/internal_mutations.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'apps';
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

const ORG = 'org_cfg';
const USER = 'user_cfg';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves on its hot
// path and never falls back to the (test-unavailable) Better Auth component.
async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: 'm1',
      userId: USER,
      organizationId: ORG,
      role: 'owner',
      createdAt: 0,
    });
  });
}

describe('apps/config', () => {
  it('stores config and syncs it into the app workflow schedule variables', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('appInstallations', {
        organizationId: ORG,
        appSlug: 'issue-desk',
        installedAt: 0,
        installedBy: USER,
        status: 'active',
        requiredIntegrations: ['github'],
        resources: [
          {
            domain: 'workflows',
            path: 'issue-desk/reconcile.json',
            contentHash: 'h',
          },
        ],
      });
    });
    // The schedule the installer created — only static defaults, no repo yet.
    const schedId: Id<'wfSchedules'> = await t.run(async (ctx) =>
      ctx.db.insert('wfSchedules', {
        organizationId: ORG,
        workflowSlug: 'issue-desk/reconcile',
        cronExpression: '*/15 * * * *',
        timezone: 'UTC',
        isActive: true,
        variables: { state: 'all' },
        createdAt: 0,
        createdBy: 'system',
      }),
    );

    const asUser = t.withIdentity({ subject: USER });
    await asUser.mutation(api.apps.config.setAppConfig, {
      organizationId: ORG,
      appSlug: 'issue-desk',
      config: { owner: 'acme', repo: 'widgets' },
    });

    // Stored on the install row + read back by getAppConfig.
    const cfg = await asUser.query(api.apps.config.getAppConfig, {
      organizationId: ORG,
      appSlug: 'issue-desk',
    });
    expect(cfg).toEqual({ owner: 'acme', repo: 'widgets' });

    // Merged into the schedule variables — state kept, owner/repo injected — so
    // the org-level reconcile schedule now targets the configured repo.
    const sched = await t.run(async (ctx) => ctx.db.get(schedId));
    expect(sched?.variables).toEqual({
      state: 'all',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('returns an empty object before the app is configured', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('appInstallations', {
        organizationId: ORG,
        appSlug: 'issue-desk',
        installedAt: 0,
        installedBy: USER,
        status: 'active',
        requiredIntegrations: [],
        resources: [],
      });
    });
    const cfg = await t
      .withIdentity({ subject: USER })
      .query(api.apps.config.getAppConfig, {
        organizationId: ORG,
        appSlug: 'issue-desk',
      });
    expect(cfg).toEqual({});
  });
});
