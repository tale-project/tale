import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_93/01_automation_slug_fields';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  appInstallations: defineTable({
    organizationId: v.string(),
    appSlug: v.optional(v.string()),
    automationSlug: v.optional(v.string()),
    appName: v.optional(v.string()),
    automationName: v.optional(v.string()),
    installedAt: v.number(),
    installedBy: v.string(),
    status: v.union(v.literal('active'), v.literal('broken')),
    requiredIntegrations: v.array(v.string()),
    resources: v.array(
      v.object({
        domain: v.string(),
        path: v.string(),
        contentHash: v.string(),
      }),
    ),
  }).index('by_org_slug', ['organizationId', 'automationSlug']),
});

describe('0.2.93/01 automation_slug_fields (reference)', () => {
  it('up renames appSlug/appName; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('appInstallations', {
        organizationId: 'org_1',
        appSlug: 'inbox',
        appName: 'Inbox',
        installedAt: 1,
        installedBy: 'user',
        status: 'active',
        requiredIntegrations: [],
        resources: [],
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('appInstallations').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('appInstallations').collect());
    expect(rows[0].automationSlug).toBe('inbox');
    expect(rows[0].automationName).toBe('Inbox');
    expect(rows[0].appSlug).toBeUndefined();

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('appInstallations').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('appInstallations').collect());
    expect(rows[0].appSlug).toBe('inbox');
    expect(rows[0].appName).toBe('Inbox');
    expect(rows[0].automationSlug).toBeUndefined();
  });
});
