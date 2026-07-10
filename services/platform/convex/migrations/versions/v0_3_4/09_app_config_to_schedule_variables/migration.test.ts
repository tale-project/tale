// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
  type WorldSeedCtx,
} from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_91/01_app_config_to_schedule_variables';
const ORG = 'org_cfg';
const APP = 'issue-desk';

async function seedProjectAndSchedule(
  ctx: WorldSeedCtx,
  organizationId: string,
  variables?: Record<string, unknown>,
): Promise<{ projectId: string; scheduleId: string }> {
  const projectId = await ctx.db.insert('projects', {
    organizationId,
    name: 'Alpha',
    createdBy: 'tester',
    createdAt: 0,
    updatedAt: 0,
  });
  const scheduleId = await ctx.db.insert('wfSchedules', {
    organizationId,
    projectId,
    workflowSlug: 'issue-desk/reconcile',
    cronExpression: '0 * * * *',
    timezone: 'UTC',
    isActive: true,
    createdAt: 0,
    createdBy: 'tester',
    ...(variables !== undefined && { variables }),
  });
  return { projectId, scheduleId };
}

async function bindingsFor(
  world: WorldHandle,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const all = (await world.run((ctx) =>
    ctx.db.query('appProjectBindings').collect(),
  )) as Array<Record<string, unknown>>;
  return all.filter((b) => b.organizationId === organizationId);
}

async function scheduleFor(
  world: WorldHandle,
  organizationId: string,
): Promise<Record<string, unknown> | undefined> {
  const all = (await world.run((ctx) =>
    ctx.db.query('wfSchedules').collect(),
  )) as Array<Record<string, unknown>>;
  return all.find((s) => s.organizationId === organizationId);
}

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (cleared bindings are
// skipped), down restoring the seed digest byte-for-byte (config back on the
// binding, CONFIG_KEYS stripped off the schedule), and the ledger transitions.
//
// The seed keeps the round trip byte-clean on purpose: the binding config
// carries ONLY the recognized CONFIG_KEYS (a non-key entry like `repository`
// is dropped by up and never restored — covered as a case), the schedule's
// seeded variables carry NO config key (a stale value would be overwritten
// and lost — covered as a case), and the org-level appInstallations row
// carries no config (its clear is one-way by design — covered as a case).
defineMigrationTest({
  id: '0.3.4/09_app_config_to_schedule_variables',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const { projectId } = await seedProjectAndSchedule(ctx, ORG, {
      maxReworkLoops: 3,
    });
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      appSlug: APP,
      installedAt: 0,
      installedBy: 'tester',
      status: 'active',
      requiredIntegrations: [],
      resources: [],
    });
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      appSlug: APP,
      projectId,
      boundAt: 0,
      boundBy: 'tester',
      config: {
        owner: 'acme',
        repo: 'widgets',
        testCommand: 'bun test',
        repoNotes: 'no flaky tests',
      },
    });
    // A second, unconfigured binding in another project must be left alone.
    const otherProjectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Beta',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('appProjectBindings', {
      organizationId: ORG,
      appSlug: APP,
      projectId: otherProjectId,
      boundAt: 0,
      boundBy: 'tester',
    });
  },

  async expectUp(world) {
    for (const binding of await bindingsFor(world, ORG)) {
      expect(binding.config).toBeUndefined();
    }

    // The static `maxReworkLoops` default survives; the config keys land on
    // the schedule.
    const schedule = await scheduleFor(world, ORG);
    expect(schedule?.variables).toEqual({
      maxReworkLoops: 3,
      owner: 'acme',
      repo: 'widgets',
      testCommand: 'bun test',
      repoNotes: 'no flaky tests',
    });
  },

  cases: {
    'merging wins over a stale schedule value and drops non-key config entries':
      async (world) => {
        const org = 'org_cfg2';
        await world.run(async (ctx) => {
          const { projectId } = await seedProjectAndSchedule(ctx, org, {
            maxReworkLoops: 3,
            owner: 'stale-owner',
          });
          await ctx.db.insert('appProjectBindings', {
            organizationId: org,
            appSlug: APP,
            projectId,
            boundAt: 0,
            boundBy: 'tester',
            // The raw `repository` composite is not a recognized key.
            config: {
              repository: 'acme/widgets',
              owner: 'acme',
              repo: 'widgets',
            },
          });
        });

        await world.applyUpOnly();

        const schedule = await scheduleFor(world, org);
        expect(schedule?.variables).toEqual({
          maxReworkLoops: 3,
          owner: 'acme',
          repo: 'widgets',
        });
        const [binding] = await bindingsFor(world, org);
        expect(binding.config).toBeUndefined();
      },

    'clears the org-level appInstallations config; down restores the binding but not that legacy copy':
      async (world) => {
        const org = 'org_cfg3';
        await world.run(async (ctx) => {
          const { projectId } = await seedProjectAndSchedule(ctx, org);
          await ctx.db.insert('appInstallations', {
            organizationId: org,
            appSlug: APP,
            installedAt: 0,
            installedBy: 'tester',
            status: 'active',
            requiredIntegrations: [],
            resources: [],
            config: { owner: 'acme', repo: 'widgets' },
          });
          await ctx.db.insert('appProjectBindings', {
            organizationId: org,
            appSlug: APP,
            projectId,
            boundAt: 0,
            boundBy: 'tester',
            config: { owner: 'acme', repo: 'widgets', testCommand: 'bun test' },
          });
        });

        const installFor = async (): Promise<
          Record<string, unknown> | undefined
        > => {
          const all = (await world.run((ctx) =>
            ctx.db.query('appInstallations').collect(),
          )) as Array<Record<string, unknown>>;
          return all.find((i) => i.organizationId === org);
        };

        await world.applyUpOnly();
        expect((await installFor())?.config).toBeUndefined();

        await world.applyDownOnly();
        const [binding] = await bindingsFor(world, org);
        expect(binding.config).toEqual({
          owner: 'acme',
          repo: 'widgets',
          testCommand: 'bun test',
        });
        const schedule = await scheduleFor(world, org);
        expect(schedule?.variables).toEqual({});
        // The org-level legacy copy is NOT restored (documented limitation).
        expect((await installFor())?.config).toBeUndefined();
      },
  },
});
