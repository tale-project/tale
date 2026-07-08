import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_91/01_app_config_to_schedule_variables';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_cfg';
const APP = 'issue-desk';

async function seedProjectAndSchedule(
  t: ReturnType<typeof convexTest>,
  variables?: Record<string, unknown>,
) {
  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Alpha',
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    });
    const scheduleId = await ctx.db.insert('wfSchedules', {
      organizationId: ORG,
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
  });
}

describe('0.2.91/01 app_config_to_schedule_variables', () => {
  it("up folds a binding's config onto the reconcile schedule and clears both tables", async () => {
    const t = convexTest(historicalSchema, modules);
    const { projectId, scheduleId } = await seedProjectAndSchedule(t);
    const bindingId = await t.run(async (ctx) => {
      await ctx.db.insert('appInstallations', {
        organizationId: ORG,
        appSlug: APP,
        installedAt: 0,
        installedBy: 'tester',
        status: 'active',
        requiredIntegrations: [],
        resources: [],
        config: { repository: 'acme/widgets', owner: 'acme', repo: 'widgets' },
      });
      return ctx.db.insert('appProjectBindings', {
        organizationId: ORG,
        appSlug: APP,
        projectId,
        boundAt: 0,
        boundBy: 'tester',
        config: {
          repository: 'acme/widgets',
          owner: 'acme',
          repo: 'widgets',
          testCommand: 'bun test',
          repoNotes: 'no flaky tests',
        },
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const binding = await t.run((ctx) => ctx.db.get(bindingId));
    expect(binding?.config).toBeUndefined();

    const install = await t.run((ctx) =>
      ctx.db
        .query('appInstallations')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', ORG).eq('appSlug', APP),
        )
        .first(),
    );
    expect(install?.config).toBeUndefined();

    const schedule = await t.run((ctx) => ctx.db.get(scheduleId));
    expect(schedule?.variables).toEqual({
      owner: 'acme',
      repo: 'widgets',
      testCommand: 'bun test',
      repoNotes: 'no flaky tests',
    });
  });

  it('merges onto existing schedule variables (config wins) and leaves an empty-config binding untouched', async () => {
    const t = convexTest(historicalSchema, modules);
    const { projectId, scheduleId } = await seedProjectAndSchedule(t, {
      maxReworkLoops: 3,
      owner: 'stale-owner',
    });
    const bindingId = await t.run(async (ctx) => {
      await ctx.db.insert('appInstallations', {
        organizationId: ORG,
        appSlug: APP,
        installedAt: 0,
        installedBy: 'tester',
        status: 'active',
        requiredIntegrations: [],
        resources: [],
      });
      return ctx.db.insert('appProjectBindings', {
        organizationId: ORG,
        appSlug: APP,
        projectId,
        boundAt: 0,
        boundBy: 'tester',
        config: { owner: 'acme', repo: 'widgets' },
      });
    });
    // A second, unconfigured binding in another project must be left alone.
    const otherProjectId = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Beta',
        createdBy: 'tester',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const unconfiguredBindingId = await t.run((ctx) =>
      ctx.db.insert('appProjectBindings', {
        organizationId: ORG,
        appSlug: APP,
        projectId: otherProjectId,
        boundAt: 0,
        boundBy: 'tester',
      }),
    );

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const schedule = await t.run((ctx) => ctx.db.get(scheduleId));
    // The static `maxReworkLoops` default survives; `owner` converges to the
    // binding's configured value (config wins over the stale placeholder).
    expect(schedule?.variables).toEqual({
      maxReworkLoops: 3,
      owner: 'acme',
      repo: 'widgets',
    });

    const binding = await t.run((ctx) => ctx.db.get(bindingId));
    expect(binding?.config).toBeUndefined();

    const unconfigured = await t.run((ctx) =>
      ctx.db.get(unconfiguredBindingId),
    );
    expect(unconfigured?.config).toBeUndefined();
  });

  it('down restores the binding config from the schedule and strips those keys back off it', async () => {
    const t = convexTest(historicalSchema, modules);
    const { projectId, scheduleId } = await seedProjectAndSchedule(t);
    const bindingId = await t.run(async (ctx) => {
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
      return ctx.db.insert('appProjectBindings', {
        organizationId: ORG,
        appSlug: APP,
        projectId,
        boundAt: 0,
        boundBy: 'tester',
        config: { owner: 'acme', repo: 'widgets', testCommand: 'bun test' },
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.90',
      only: [meta.id],
    });

    const binding = await t.run((ctx) => ctx.db.get(bindingId));
    expect(binding?.config).toEqual({
      owner: 'acme',
      repo: 'widgets',
      testCommand: 'bun test',
    });

    const schedule = await t.run((ctx) => ctx.db.get(scheduleId));
    expect(schedule?.variables).toEqual({});

    // The org-level legacy copy is NOT restored (documented limitation).
    const install = await t.run((ctx) =>
      ctx.db
        .query('appInstallations')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', ORG).eq('appSlug', APP),
        )
        .first(),
    );
    expect(install?.config).toBeUndefined();
  });
});
