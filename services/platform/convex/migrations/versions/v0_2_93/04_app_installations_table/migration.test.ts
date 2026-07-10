import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_93/04_app_installations_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  appInstallations: defineTable({
    organizationId: v.string(),
    automationSlug: v.string(),
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
    // The down queries the legacy table under the world-schema index name
    // (`by_org_slug` keeps its 0.2.88-era appSlug field list there).
  }).index('by_org_automation_slug', ['organizationId', 'automationSlug']),
  automationInstallations: defineTable({
    organizationId: v.string(),
    automationSlug: v.string(),
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

describe('0.2.93/04 app_installations_table', () => {
  it('up copies into automationInstallations; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('appInstallations', {
        organizationId: 'org_1',
        automationSlug: 'inbox',
        automationName: 'Inbox',
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

    expect(
      await t.run((ctx) => ctx.db.query('appInstallations').collect()),
    ).toHaveLength(0);
    let target = await t.run((ctx) =>
      ctx.db.query('automationInstallations').collect(),
    );
    expect(target).toHaveLength(1);
    expect(target[0].automationSlug).toBe('inbox');

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('automationInstallations').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });

    target = await t.run((ctx) =>
      ctx.db.query('automationInstallations').collect(),
    );
    expect(target).toHaveLength(0);
    const legacy = await t.run((ctx) =>
      ctx.db.query('appInstallations').collect(),
    );
    expect(legacy).toHaveLength(1);
    expect(legacy[0].automationSlug).toBe('inbox');
  });
});
