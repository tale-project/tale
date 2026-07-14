// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_3_4/42_retire_github_agent_installs';

// Standard ritual: destructive gate, rows snapshotted before deletion,
// idempotent up, down = generic snapshot-restore back to the seed digest.
defineMigrationTest({
  id: '0.3.4/42_retire_github_agent_installs',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'issue-triager',
      installedAt: 1_000,
      installedBy: 'integration:github',
      contentHash: 'hash-triager',
      enabled: true,
      bundledBy: 'github',
    });
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'pull-request-reviewer',
      installedAt: 2_000,
      installedBy: 'integration:github',
      contentHash: 'hash-reviewer',
      enabled: false,
      disabledReason: 'integration_disabled',
      bundledBy: 'github',
    });
    // An automation-nested agent of similar purpose — must survive.
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'review-github-pr/pr-reviewer',
      installedAt: 3_000,
      installedBy: 'system',
      contentHash: 'hash-nested',
      enabled: true,
    });
  },

  async expectUp(world) {
    const remaining = await world.run(
      async (ctx) =>
        (await ctx.db.query('agentInstallations').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].agentSlug).toBe('review-github-pr/pr-reviewer');
  },
});
