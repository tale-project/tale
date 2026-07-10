import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_93/05_app_project_bindings_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const bindingTable = defineTable({
  organizationId: v.string(),
  automationSlug: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
})
  .index('by_org_slug_project', [
    'organizationId',
    'automationSlug',
    'projectId',
  ])
  // The down queries the legacy table under the world-schema index name
  // (`by_org_slug_project` keeps its 0.2.88-era appSlug field list there).
  .index('by_org_automation_slug_project', [
    'organizationId',
    'automationSlug',
    'projectId',
  ]);

const fixtureSchema = defineSchema({
  appProjectBindings: bindingTable,
  automationProjectBindings: bindingTable,
  projects: defineTable({ organizationId: v.string() }),
});

describe('0.2.93/05 app_project_bindings_table', () => {
  it('up copies rows; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', { organizationId: 'org_1' }),
    );

    await t.run((ctx) =>
      ctx.db.insert('appProjectBindings', {
        organizationId: 'org_1',
        automationSlug: 'inbox',
        projectId,
        boundAt: 1,
        boundBy: 'user',
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('appProjectBindings').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });

    expect(
      await t.run((ctx) => ctx.db.query('appProjectBindings').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('automationProjectBindings').collect()),
    ).toHaveLength(1);

    await t.run(async (ctx) => {
      for (const d of await ctx.db
        .query('automationProjectBindings')
        .collect()) {
        await migration.down(ctx as never, d as never);
      }
    });

    expect(
      await t.run((ctx) => ctx.db.query('automationProjectBindings').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('appProjectBindings').collect()),
    ).toHaveLength(1);
  });
});
