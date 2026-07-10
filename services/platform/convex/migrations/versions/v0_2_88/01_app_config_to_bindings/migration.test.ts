// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_88/01_app_config_to_bindings';
const ORG = 'org_cfg';
const APP = 'issue-desk';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (the copied config cleared, the pre-existing
// per-project config preserved), and the ledger transitions.
defineMigrationTest({
  id: '0.2.88/01_app_config_to_bindings',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      appSlug: APP,
      installedAt: 0,
      installedBy: 'tester',
      status: 'active',
      requiredIntegrations: [],
      resources: [],
      config: { owner: 'acme', repo: 'widgets' },
    });
    // Binding without config — up copies the org install config onto it.
    const alphaId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Alpha',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      appSlug: APP,
      projectId: alphaId,
      boundAt: 0,
      boundBy: 'tester',
    });
    // Binding that already has its own config — up must leave it untouched
    // (and down must preserve it, since it differs from the org copy).
    const betaId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Beta',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      appSlug: APP,
      projectId: betaId,
      boundAt: 0,
      boundBy: 'tester',
      config: { owner: 'other', repo: 'thing' },
    });
  },

  async expectUp(world) {
    const { byProject } = await world.run(async (ctx) => {
      const projects = (await ctx.db.query('projects').collect()) as Array<
        Record<string, unknown>
      >;
      const bindings = (await ctx.db
        .query('appProjectBindings')
        .collect()) as Array<Record<string, unknown>>;
      const map: Record<string, Record<string, unknown> | undefined> = {};
      for (const project of projects) {
        map[String(project.name)] = bindings.find(
          (b) => b.projectId === project._id,
        );
      }
      return { byProject: map };
    });

    // The config-less binding received the org install's config.
    expect(byProject.Alpha?.config).toEqual({ owner: 'acme', repo: 'widgets' });
    // The binding with its own config kept it.
    expect(byProject.Beta?.config).toEqual({ owner: 'other', repo: 'thing' });
  },
});
