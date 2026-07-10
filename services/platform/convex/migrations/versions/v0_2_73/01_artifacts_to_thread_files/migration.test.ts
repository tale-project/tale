import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_73/01_artifacts_to_thread_files';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Both tables: the legacy `artifacts` (source) and `threadFiles` (target).
const fixtureSchema = defineSchema({
  artifacts: defineTable({
    organizationId: v.string(),
    threadId: v.string(),
    type: v.string(),
    title: v.string(),
    content: v.string(),
    revision: v.number(),
    createdByMessageId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_thread', ['threadId']),
  threadFiles: defineTable({
    organizationId: v.string(),
    threadId: v.string(),
    path: v.string(),
    storageId: v.id('_storage'),
    size: v.number(),
    contentType: v.string(),
    source: v.union(
      v.literal('user_upload'),
      v.literal('agent_write'),
      v.literal('run_output'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_thread_and_path', ['threadId', 'path'])
    .index('by_thread_and_updatedAt', ['threadId', 'updatedAt'])
    .index('by_organizationId', ['organizationId']),
});

const ORG = 'org_1';
const THREAD = 'thread_1';

describe('0.2.73/01 artifacts_to_thread_files (reference)', () => {
  it('up re-keys an artifact into threadFiles; down removes it; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('artifacts', {
        organizationId: ORG,
        threadId: THREAD,
        type: 'markdown',
        title: 'My Notes',
        content: '# hello',
        revision: 1,
        createdByMessageId: 'msg_1',
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    // up
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('artifacts').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    let files = await t.run((ctx) => ctx.db.query('threadFiles').collect());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      organizationId: ORG,
      threadId: THREAD,
      path: 'my-notes.md',
      contentType: 'text/markdown',
      source: 'agent_write',
      size: '# hello'.length,
    });
    // Content actually landed in storage (resolve the blob inside the run —
    // a Blob is not a Convex-serializable return value across t.run).
    const stored = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(files[0].storageId);
      return blob === null ? null : await blob.text();
    });
    expect(stored).toBe('# hello');

    // up again is a no-op (one threadFiles row per (threadId, path))
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('artifacts').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    files = await t.run((ctx) => ctx.db.query('threadFiles').collect());
    expect(files).toHaveLength(1);

    // down removes the threadFiles row (and frees storage)
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('artifacts').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });
    files = await t.run((ctx) => ctx.db.query('threadFiles').collect());
    expect(files).toHaveLength(0);
    // The original artifacts row is left intact by the transform.
    const artifacts = await t.run((ctx) => ctx.db.query('artifacts').collect());
    expect(artifacts).toHaveLength(1);
  });
});
