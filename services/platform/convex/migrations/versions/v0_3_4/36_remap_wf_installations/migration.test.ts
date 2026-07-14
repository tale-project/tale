// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/36_remap_wf_installations';

// The harness runs the standard ritual: up through the real runner, handler
// idempotency over migrated state, and down restoring the seed digest
// byte-for-byte (the inverse map patches the slug back; no snapshots — the
// remap is bijective).
defineMigrationTest({
  id: '0.3.4/36_remap_wf_installations',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('wfInstallations', {
      organizationId: 'org_1',
      workflowSlug: 'projects/tasks/triage-unassigned-tasks',
      installedAt: 1_000,
      installedBy: 'system',
      contentHash: 'hash-triage',
    });
    // Not a mapped slug — must ride through both directions untouched.
    await ctx.db.insert('wfInstallations', {
      organizationId: 'org_1',
      workflowSlug: 'org-custom-workflow',
      installedAt: 2_000,
      installedBy: 'user_1',
      contentHash: 'hash-custom',
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx) =>
        (await ctx.db.query('wfInstallations').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(rows).toHaveLength(2);
    const bySlug = new Map(rows.map((r) => [r.workflowSlug, r]));
    const remapped = bySlug.get('projects/tasks/triage-unassigned');
    expect(
      remapped,
      'mapped row remapped to the automation slug',
    ).toBeDefined();
    expect(remapped?.automationSlug, 'ownership stamped').toBe(
      'projects/tasks/triage-unassigned',
    );
    expect(
      bySlug.get('org-custom-workflow'),
      'unmapped row untouched',
    ).toBeDefined();
    expect(bySlug.has('projects/tasks/triage-unassigned-tasks')).toBe(false);
  },
});
