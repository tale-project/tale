// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_2_93/02_app_project_bindings_automation_slug';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (renamed rows are
// skipped), down restoring the seed digest byte-for-byte, and the ledger
// transitions.
defineMigrationTest({
  id: '0.3.4/14_app_project_bindings_automation_slug',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Alpha',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      appSlug: 'inbox',
      projectId,
      boundAt: 1,
      boundBy: 'user',
    });
  },

  async expectUp(world) {
    const rows = (await world.run((ctx) =>
      ctx.db.query('appProjectBindings').collect(),
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].automationSlug).toBe('inbox');
    expect(rows[0].appSlug).toBeUndefined();
  },
});
