// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_1/01_purge_project_discussions';

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte), ledger transitions, snapshot hygiene,
// and the destructive gate. This file provides DATA + migration-specific truth.
defineMigrationTest({
  id: '0.4.1/01_purge_project_discussions',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const now = 1_700_000_000_000;
    // A retired project-discussion row — the purge target.
    await ctx.db.insert('threadMetadata', {
      threadId: 't_discussion_1',
      userId: 'user_owner',
      chatType: 'general',
      status: 'active',
      kind: 'project_discussion',
      organizationId: 'org_1',
      title: 'How should we get started?',
      discussionStatus: 'open',
      discussionCategory: 'general',
      agentReplyDepth: 1,
      createdAt: now,
      updatedAt: now,
      lastReplyAt: now,
      generationStatus: 'idle',
    });
    // A task-comment thread and a plain chat — both must survive untouched.
    await ctx.db.insert('threadMetadata', {
      threadId: 't_task_comments_1',
      userId: 'user_owner',
      chatType: 'general',
      status: 'active',
      kind: 'task_discussion',
      organizationId: 'org_1',
      title: 'Ship the report',
      discussionStatus: 'open',
      discussionCategory: 'general',
      agentReplyDepth: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('threadMetadata', {
      threadId: 't_chat_1',
      userId: 'user_owner',
      chatType: 'general',
      status: 'active',
      kind: 'chat',
      organizationId: 'org_1',
      title: 'Private chat',
      createdAt: now,
    });
  },

  async expectUp(world) {
    await world.run(async (ctx) => {
      const rows = await ctx.db.query('threadMetadata').collect();
      const kinds = rows.map((r: { kind?: string }) => r.kind).sort();
      // The discussion row is gone; the task-comment and chat rows survive.
      expect(kinds).toEqual(['chat', 'task_discussion']);
      expect(
        rows.find(
          (r: { threadId?: string }) => r.threadId === 't_discussion_1',
        ),
      ).toBeUndefined();

      // The purged row is safely in the snapshot store for `down`.
      const snapshots = await ctx.db.query('migrationSnapshots').collect();
      const purged = snapshots.filter(
        (s: { migrationId?: string }) =>
          s.migrationId === '0.4.1/01_purge_project_discussions',
      );
      expect(purged).toHaveLength(1);
      expect(purged[0]?.payload).toMatchObject({
        threadId: 't_discussion_1',
        kind: 'project_discussion',
      });
    });
  },
});
