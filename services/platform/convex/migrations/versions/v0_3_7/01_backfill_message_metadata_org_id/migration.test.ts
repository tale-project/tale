// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_7/01_backfill_message_metadata_org_id';
const ORG = 'org_test_1';
const THREAD_WITH_ORG = 'thread_with_org';
const THREAD_ORPHAN = 'thread_orphan';

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte — the org is cleared), ledger transitions,
// snapshot hygiene, and the destructive gate. This file provides DATA + truth.
defineMigrationTest({
  id: '0.3.7/01_backfill_message_metadata_org_id',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // A thread that carries an org — its message rows get backfilled.
    await ctx.db.insert('threadMetadata', {
      threadId: THREAD_WITH_ORG,
      userId: 'user_1',
      chatType: 'general',
      status: 'active',
      createdAt: 1,
      organizationId: ORG,
    });
    // Pre-migration message rows carry NO organizationId (the state `up` fixes).
    await ctx.db.insert('messageMetadata', {
      messageId: 'msg_resolvable',
      threadId: THREAD_WITH_ORG,
      model: 'gpt-4o',
      provider: 'openai',
    });
    // Skip path: a message whose thread has no threadMetadata row (deleted /
    // never existed) must be LEFT unset — exercises the orphan branch and the
    // tenant-isolation guarantee that org-less rows never join a rollup.
    await ctx.db.insert('messageMetadata', {
      messageId: 'msg_orphan',
      threadId: THREAD_ORPHAN,
      model: 'gpt-4o',
      provider: 'openai',
    });
  },

  async expectUp(world) {
    const rows = (await world.run((ctx) =>
      ctx.db.query('messageMetadata').collect(),
    )) as Array<Record<string, unknown>>;

    const resolvable = rows.find((r) => r.messageId === 'msg_resolvable');
    expect(resolvable?.organizationId).toBe(ORG);

    // Orphaned row's thread has no org → left unset.
    const orphan = rows.find((r) => r.messageId === 'msg_orphan');
    expect(orphan?.organizationId).toBeUndefined();
  },
});
