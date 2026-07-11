import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_90/09_thread_metadata_app_discussion';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Minimal post-change threadMetadata shape: the new columns + widened kind are
// optional so both legacy chat rows and app rows validate (mirrors the
// post-change schema; unrelated columns elided).
const fixtureSchema = defineSchema({
  threadMetadata: defineTable({
    threadId: v.string(),
    userId: v.string(),
    chatType: v.string(),
    status: v.string(),
    createdAt: v.number(),
    organizationId: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal('chat'),
        v.literal('project_discussion'),
        v.literal('task_discussion'),
        v.literal('app_discussion'),
      ),
    ),
    appSlug: v.optional(v.string()),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
  })
    .index('by_threadId', ['threadId'])
    .index('by_org_app_subject', [
      'organizationId',
      'appSlug',
      'subjectType',
      'subjectId',
    ]),
});

type Ctx = Parameters<Parameters<ReturnType<typeof convexTest>['run']>[0]>[0];

async function insertRow(
  ctx: Ctx,
  over: Partial<{
    kind: 'chat' | 'project_discussion' | 'task_discussion' | 'app_discussion';
    appSlug: string;
    subjectType: string;
    subjectId: string;
  }> = {},
) {
  await ctx.db.insert('threadMetadata', {
    threadId: `t_${Math.random().toString(36).slice(2)}`,
    userId: 'user_1',
    chatType: 'general',
    status: 'active',
    createdAt: 1,
    organizationId: 'org_1',
    ...over,
  });
}

describe('0.3.4/08 thread_metadata_app_discussion (reference)', () => {
  it('up is a no-op; down strips the app columns + kind so rows re-validate against the pre-change schema', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      // App thread — down must strip columns AND clear the kind literal.
      await insertRow(ctx, {
        kind: 'app_discussion',
        appSlug: 'issue-desk',
        subjectType: 'task',
        subjectId: 'task_42',
      });
      // Legacy chat + project discussion rows — untouched throughout.
      await insertRow(ctx);
      await insertRow(ctx, { kind: 'project_discussion' });
    });

    // up: no-op — the app row keeps its subject attribution.
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(
      rows
        .map((r) => r.appSlug)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['issue-desk', undefined, undefined]);

    // down: app columns + the new kind literal cleared on the app row; the
    // legacy rows (incl. the project discussion's kind) stay untouched.
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(
      rows.every(
        (r) =>
          r.appSlug === undefined &&
          r.subjectType === undefined &&
          r.subjectId === undefined &&
          r.kind !== 'app_discussion',
      ),
    ).toBe(true);
    expect(rows.filter((r) => r.kind === 'project_discussion')).toHaveLength(1);

    // down again is a no-op (all already cleared).
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(rows.every((r) => r.kind !== 'app_discussion')).toBe(true);
  });
});
