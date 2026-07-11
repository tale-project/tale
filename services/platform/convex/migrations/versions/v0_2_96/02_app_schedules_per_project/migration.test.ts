// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_88/02_app_schedules_per_project';
const ORG = 'org_sched';
const APP = 'issue-desk';
const SLUG = 'issue-desk/reconcile';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (projectId unset again), and the ledger
// transitions.
defineMigrationTest({
  id: '0.2.96/02_app_schedules_per_project',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      appSlug: APP,
      installedAt: 0,
      installedBy: 'tester',
      status: 'active',
      requiredIntegrations: [],
      resources: [
        {
          domain: 'workflows',
          path: 'issue-desk/reconcile.json',
          contentHash: 'x',
        },
      ],
    });
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Alpha',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      appSlug: APP,
      projectId,
      boundAt: 0,
      boundBy: 'tester',
    });
    // Org-level schedule owned by the app — up assigns it to the binding.
    await ctx.db.insert('wfSchedules', {
      organizationId: ORG,
      workflowSlug: SLUG,
      cronExpression: '*/15 * * * *',
      timezone: 'UTC',
      isActive: true,
      createdAt: 0,
      createdBy: 'system',
      variables: { state: 'all', owner: 'acme', repo: 'widgets' },
    });
    // Non-app schedule (no `<app>/` prefix) — must stay org-level.
    await ctx.db.insert('wfSchedules', {
      organizationId: ORG,
      workflowSlug: 'plain-workflow',
      cronExpression: '0 0 * * *',
      timezone: 'UTC',
      isActive: true,
      createdAt: 0,
      createdBy: 'system',
    });
  },

  async expectUp(world) {
    const { binding, schedules } = await world.run(async (ctx) => ({
      binding: (await ctx.db.query('appProjectBindings').first()) as Record<
        string,
        unknown
      >,
      schedules: (await ctx.db.query('wfSchedules').collect()) as Array<
        Record<string, unknown>
      >,
    }));

    const appSchedule = schedules.find((s) => s.workflowSlug === SLUG);
    expect(appSchedule?.projectId).toBe(binding.projectId);

    // The non-app schedule stays org-level.
    const plain = schedules.find((s) => s.workflowSlug === 'plain-workflow');
    expect(plain?.projectId).toBeUndefined();
  },
});
