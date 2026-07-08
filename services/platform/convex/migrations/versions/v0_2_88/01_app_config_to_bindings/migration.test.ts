import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_88/01_app_config_to_bindings';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_cfg';
const APP = 'issue-desk';

describe('0.2.88/01 app_config_to_bindings', () => {
  it('up copies org install config onto a binding; down clears the copy', async () => {
    const t = convexTest(historicalSchema, modules);
    const projectId = await t.run(async (ctx) => {
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
      return pid;
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    const afterUp = await t.run((ctx) =>
      ctx.db.query('appProjectBindings').first(),
    );
    expect(afterUp?.projectId).toBe(projectId);
    expect(afterUp?.config).toEqual({ owner: 'acme', repo: 'widgets' });

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.87',
      only: [meta.id],
    });
    const afterDown = await t.run((ctx) =>
      ctx.db.query('appProjectBindings').first(),
    );
    expect(afterDown?.config).toBeUndefined();
  });

  it('up leaves a binding that already has its own config', async () => {
    const t = convexTest(historicalSchema, modules);
    await t.run(async (ctx) => {
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
      const pid = await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Beta',
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
        config: { owner: 'other', repo: 'thing' },
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    const binding = await t.run((ctx) =>
      ctx.db.query('appProjectBindings').first(),
    );
    expect(binding?.config).toEqual({ owner: 'other', repo: 'thing' });
  });
});
