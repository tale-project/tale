// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/39_remap_workflow_env';

// The harness runs the standard ritual: up through the real runner, handler
// idempotency over migrated state, and down restoring the seed digest
// byte-for-byte (the inverse map patches the slug back; no snapshots — the
// remap is bijective).
defineMigrationTest({
  id: '0.3.4/39_remap_workflow_env',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('workflowEnv', {
      organizationId: 'org_1',
      workflowSlug: 'imap_smtp/sync-emails-from-imap_smtp',
      stepSlug: '',
      key: 'SYNC_LIMIT',
      isSecret: false,
      value: '50',
      updatedAt: 1_000,
      updatedBy: 'user_1',
    });
    // Not a mapped slug — must ride through both directions untouched.
    await ctx.db.insert('workflowEnv', {
      organizationId: 'org_1',
      workflowSlug: 'org-custom-workflow',
      stepSlug: '',
      key: 'TOKEN',
      isSecret: true,
      encryptedValue: 'jwe',
      updatedAt: 2_000,
      updatedBy: 'user_1',
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx) =>
        (await ctx.db.query('workflowEnv').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(rows).toHaveLength(2);
    const bySlug = new Map(rows.map((r) => [r.workflowSlug, r]));
    const remapped = bySlug.get('imap-smtp/sync-emails');
    expect(
      remapped,
      'mapped row remapped to the automation slug',
    ).toBeDefined();
    expect(
      bySlug.get('org-custom-workflow'),
      'unmapped row untouched',
    ).toBeDefined();
    expect(bySlug.has('imap_smtp/sync-emails-from-imap_smtp')).toBe(false);
  },
});
