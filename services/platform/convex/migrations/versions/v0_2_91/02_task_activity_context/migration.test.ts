import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_91/02_task_activity_context';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  taskActivity: defineTable({
    organizationId: v.string(),
    taskId: v.string(),
    projectId: v.string(),
    actorType: v.union(v.literal('user'), v.literal('agent')),
    actorId: v.string(),
    action: v.string(),
    context: v.optional(
      v.object({
        workflowSlug: v.optional(v.string()),
        wfExecutionId: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  }),
});

describe('0.2.91/02 task_activity_context (reference)', () => {
  it('up is a no-op; down drops context', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('taskActivity', {
        organizationId: 'org_1',
        taskId: 'task_1',
        projectId: 'proj_1',
        actorType: 'agent',
        actorId: 'workflow',
        action: 'status.changed',
        context: { workflowSlug: 'task-ops/status-gate' },
        createdAt: Date.now(),
      });
      await ctx.db.insert('taskActivity', {
        organizationId: 'org_1',
        taskId: 'task_2',
        projectId: 'proj_1',
        actorType: 'user',
        actorId: 'user_1',
        action: 'created',
        createdAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('taskActivity').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('taskActivity').collect());
    expect(rows.find((r) => r.actorId === 'workflow')?.context).toEqual({
      workflowSlug: 'task-ops/status-gate',
    });

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('taskActivity').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('taskActivity').collect());
    expect(rows.every((r) => r.context === undefined)).toBe(true);
  });
});
