// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/38_remap_wf_event_subscriptions';

// The harness runs the standard ritual: up through the real runner, handler
// idempotency over migrated state, and down restoring the seed digest
// byte-for-byte (the inverse map patches the slug back; no snapshots — the
// remap is bijective).
defineMigrationTest({
  id: '0.3.4/38_remap_wf_event_subscriptions',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: 'org_1',
      workflowSlug: 'projects/tasks/run-assigned-task',
      eventType: 'task.assigned',
      isActive: true,
      createdAt: 1_000,
      createdBy: 'system',
    });
    // Not a mapped slug — must ride through both directions untouched.
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: 'org_1',
      workflowSlug: 'org-custom-workflow',
      eventType: 'task.created',
      isActive: true,
      createdAt: 2_000,
      createdBy: 'user_1',
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx) =>
        (await ctx.db.query('wfEventSubscriptions').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(rows).toHaveLength(2);
    const bySlug = new Map(rows.map((r) => [r.workflowSlug, r]));
    const remapped = bySlug.get('run-assigned-task');
    expect(
      remapped,
      'mapped row remapped to the automation slug',
    ).toBeDefined();
    expect(
      bySlug.get('org-custom-workflow'),
      'unmapped row untouched',
    ).toBeDefined();
    expect(bySlug.has('projects/tasks/run-assigned-task')).toBe(false);
  },
});
