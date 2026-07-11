// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_93/05_app_project_bindings_table';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (the legacy table is
// empty), down walking the populated target table (`downTable`) and restoring
// the seed digest byte-for-byte, and the ledger transitions.
defineMigrationTest({
  id: '0.3.4/17_app_project_bindings_table',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Alpha',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    // Post-0.3.4/14 shape: the slug rename already ran.
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      automationSlug: 'inbox',
      projectId,
      boundAt: 1,
      boundBy: 'user',
    });
  },

  async expectUp(world) {
    expect(
      await world.run((ctx) => ctx.db.query('appProjectBindings').collect()),
    ).toHaveLength(0);
    const target = (await world.run((ctx) =>
      ctx.db.query('automationProjectBindings').collect(),
    )) as Array<Record<string, unknown>>;
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      organizationId: ORG,
      automationSlug: 'inbox',
      boundBy: 'user',
    });
  },
});
