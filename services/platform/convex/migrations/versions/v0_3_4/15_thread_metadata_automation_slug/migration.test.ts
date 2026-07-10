// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_93/03_thread_metadata_automation_slug';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (renamed rows are
// skipped), down restoring the seed digest byte-for-byte, and the ledger
// transitions.
defineMigrationTest({
  id: '0.3.4/15_thread_metadata_automation_slug',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('threadMetadata', {
      threadId: 't1',
      userId: 'u1',
      chatType: 'general',
      status: 'active',
      createdAt: 1,
      kind: 'app_discussion',
      organizationId: ORG,
      appSlug: 'inbox',
      subjectType: 'app',
      subjectId: 'inbox',
    });
    // A plain chat row without app columns must be left untouched.
    await ctx.db.insert('threadMetadata', {
      threadId: 't2',
      userId: 'u1',
      chatType: 'general',
      status: 'active',
      createdAt: 2,
      kind: 'chat',
      organizationId: ORG,
    });
  },

  async expectUp(world) {
    const rows = (await world.run((ctx) =>
      ctx.db.query('threadMetadata').collect(),
    )) as Array<Record<string, unknown>>;

    const discussion = rows.find((r) => r.threadId === 't1');
    expect(discussion?.automationSlug).toBe('inbox');
    expect(discussion?.subjectType).toBe('automation');
    expect(discussion?.appSlug).toBeUndefined();

    const chat = rows.find((r) => r.threadId === 't2');
    expect(chat?.automationSlug).toBeUndefined();
    expect(chat?.subjectType).toBeUndefined();
  },
});
