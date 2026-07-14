// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/37_remap_wf_schedules';

// The harness runs the standard ritual: up through the real runner, handler
// idempotency over migrated state, and down restoring the seed digest
// byte-for-byte (the inverse map patches the slug back; no snapshots — the
// remap is bijective).
defineMigrationTest({
  id: '0.3.4/37_remap_wf_schedules',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // A workflow whose slug genuinely MOVES (`…/enforce-task-slas` →
    // `…/enforce-slas`). Most pack automations keep their folder and a few map
    // onto themselves, so seeding an identity-mapped slug would make the
    // assertions below vacuous — the row would look "remapped" without the
    // migration doing anything.
    await ctx.db.insert('wfSchedules', {
      organizationId: 'org_1',
      workflowSlug: 'projects/tasks/enforce-task-slas',
      cronExpression: '0 * * * *',
      timezone: 'UTC',
      isActive: true,
      createdAt: 1_000,
      createdBy: 'system',
    });
    // Not a mapped slug — must ride through both directions untouched.
    await ctx.db.insert('wfSchedules', {
      organizationId: 'org_1',
      workflowSlug: 'org-custom-workflow',
      cronExpression: '30 2 * * *',
      timezone: 'UTC',
      isActive: false,
      createdAt: 2_000,
      createdBy: 'user_1',
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx) =>
        (await ctx.db.query('wfSchedules').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(rows).toHaveLength(2);
    const bySlug = new Map(rows.map((r) => [r.workflowSlug, r]));
    const remapped = bySlug.get('projects/tasks/enforce-slas');
    expect(
      remapped,
      'mapped row remapped to the automation slug',
    ).toBeDefined();
    expect(
      bySlug.get('org-custom-workflow'),
      'unmapped row untouched',
    ).toBeDefined();
    expect(bySlug.has('projects/tasks/enforce-task-slas')).toBe(false);
  },
});
