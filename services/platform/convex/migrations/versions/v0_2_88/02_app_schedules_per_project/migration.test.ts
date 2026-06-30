import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import schema from '../../../../schema';
import { buildModules } from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_88/02_app_schedules_per_project';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_sched';
const APP = 'issue-desk';
const SLUG = 'issue-desk/reconcile';

describe('0.2.88/02 app_schedules_per_project', () => {
  it('up assigns an org-level app schedule to its binding; down unsets it', async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.run(async (ctx) => {
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
      const pid = await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Alpha',
        createdBy: 'tester',
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert('appProjectBindings', {
        organizationId: ORG,
        appSlug: APP,
        projectId: pid,
        boundAt: 0,
        boundBy: 'tester',
      });
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
      return pid;
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    const afterUp = await t.run((ctx) => ctx.db.query('wfSchedules').first());
    expect(afterUp?.projectId).toBe(projectId);

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.87',
      only: [meta.id],
    });
    const afterDown = await t.run((ctx) => ctx.db.query('wfSchedules').first());
    expect(afterDown?.projectId).toBeUndefined();
  });

  it('leaves a non-app schedule untouched', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('wfSchedules', {
        organizationId: ORG,
        workflowSlug: 'plain-workflow',
        cronExpression: '0 0 * * *',
        timezone: 'UTC',
        isActive: true,
        createdAt: 0,
        createdBy: 'system',
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    const sched = await t.run((ctx) => ctx.db.query('wfSchedules').first());
    expect(sched?.projectId).toBeUndefined();
  });
});
