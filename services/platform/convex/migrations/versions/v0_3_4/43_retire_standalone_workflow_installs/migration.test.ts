// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/43_retire_standalone_workflow_installs';

// Standard ritual: destructive gate, rows snapshotted before deletion,
// idempotent up, down = generic snapshot-restore back to the seed digest.
defineMigrationTest({
  id: '0.3.4/43_retire_standalone_workflow_installs',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('wfInstallations', {
      organizationId: 'org_1',
      workflowSlug: 'github/sync-issues-from-github',
      installedAt: 1_000,
      installedBy: 'integration:github',
      contentHash: 'hash-sync',
    });
    await ctx.db.insert('wfInstallations', {
      organizationId: 'org_1',
      workflowSlug: 'conversations/sync-messages-to-conversations',
      installedAt: 2_000,
      installedBy: 'user_1',
      contentHash: 'hash-generic',
    });
    // The successor automation's inline workflow — must survive the sweep.
    await ctx.db.insert('wfInstallations', {
      organizationId: 'org_1',
      workflowSlug: 'sync-github-issues',
      installedAt: 3_000,
      installedBy: 'system',
      contentHash: 'hash-automation',
      automationSlug: 'sync-github-issues',
    });
  },

  async expectUp(world) {
    const remaining = await world.run(
      async (ctx) =>
        (await ctx.db.query('wfInstallations').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workflowSlug).toBe('sync-github-issues');
  },
});
