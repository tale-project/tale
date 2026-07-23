// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/20_drop_chat_message_queue';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/20_drop_chat_message_queue',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('chatMessageQueue', {
      organizationId: 'org_0',
      threadId: 'thread_1',
      userId: 'user_0',
      userEmail: 'a@example.com',
      userName: 'Ada',
      agentSlug: 'assistant',
      modelId: 'gpt-4o',
      messageId: 'qmsg_1',
      deferredPersist: true,
      text: 'keep going while it works',
      status: 'waiting_media',
      createdAt: 1_717_000_100_000,
      attachments: [
        {
          fileId: 'attach-blob-1',
          fileName: 'chart.png',
          fileType: 'image/png',
          fileSize: 2048,
        },
      ],
      videoJobIds: ['video-job-1'],
      waitingSince: 1_717_000_100_000,
    });
    await ctx.db.insert('chatMessageQueue', {
      organizationId: 'org_1',
      threadId: 'thread_2',
      userId: 'user_1',
      userEmail: 'b@example.com',
      userName: 'Ben',
      agentSlug: 'writer',
      messageId: 'qmsg_2',
      text: 'send this next',
      status: 'queued',
      createdAt: 1_717_000_200_000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) =>
      ctx.db.query('chatMessageQueue').collect(),
    );
    expect(rows).toHaveLength(0);

    // One snapshot per deleted row, carrying the full legacy payload.
    const snaps = await world.run(
      async (ctx) =>
        (await ctx.db
          .query('migrationSnapshots')
          .withIndex(
            'by_migration',
            (q: { eq: (f: string, v: string) => unknown }) =>
              q.eq('migrationId', world.meta.id),
          )
          .collect()) as Array<Record<string, unknown>>,
    );
    expect(snaps).toHaveLength(2);
    expect(
      snaps.map((s) => (s.payload as { messageId: string }).messageId).sort(),
    ).toEqual(['qmsg_1', 'qmsg_2']);
  },
});
