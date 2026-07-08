import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR =
  'migrations/versions/v0_2_93/02_app_project_bindings_automation_slug';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  appProjectBindings: defineTable({
    organizationId: v.string(),
    appSlug: v.optional(v.string()),
    automationSlug: v.optional(v.string()),
    projectId: v.id('projects'),
    boundAt: v.number(),
    boundBy: v.string(),
  }).index('by_org_slug_project', [
    'organizationId',
    'automationSlug',
    'projectId',
  ]),
  projects: defineTable({ organizationId: v.string() }),
});

describe('0.2.93/02 app_project_bindings_automation_slug', () => {
  it('up renames appSlug→automationSlug; down restores', async () => {
    const t = convexTest(fixtureSchema, modules);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', { organizationId: 'org_1' }),
    );

    await t.run((ctx) =>
      ctx.db.insert('appProjectBindings', {
        organizationId: 'org_1',
        appSlug: 'inbox',
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
    let rows = await t.run((ctx) =>
      ctx.db.query('appProjectBindings').collect(),
    );
    expect(rows[0].automationSlug).toBe('inbox');
    expect(rows[0].appSlug).toBeUndefined();

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('appProjectBindings').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('appProjectBindings').collect());
    expect(rows[0].appSlug).toBe('inbox');
    expect(rows[0].automationSlug).toBeUndefined();
  });
});
