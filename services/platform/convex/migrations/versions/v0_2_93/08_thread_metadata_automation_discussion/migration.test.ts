// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_2_93/08_thread_metadata_automation_discussion';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (already-renamed kinds
// are skipped), down restoring the seed digest byte-for-byte, and the ledger
// transitions.
defineMigrationTest({
  id: '0.2.93/08_thread_metadata_automation_discussion',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('threadMetadata', {
      threadId: 't1',
      userId: 'u1',
      chatType: 'general',
      status: 'active',
      createdAt: 1,
      organizationId: ORG,
      kind: 'app_discussion',
    });
    // A non-discussion kind must be left untouched.
    await ctx.db.insert('threadMetadata', {
      threadId: 't2',
      userId: 'u1',
      chatType: 'general',
      status: 'active',
      createdAt: 2,
      organizationId: ORG,
      kind: 'chat',
    });
  },

  async expectUp(world) {
    const rows = (await world.run((ctx) =>
      ctx.db.query('threadMetadata').collect(),
    )) as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.threadId === 't1')?.kind).toBe(
      'automation_discussion',
    );
    expect(rows.find((r) => r.threadId === 't2')?.kind).toBe('chat');
  },
});
