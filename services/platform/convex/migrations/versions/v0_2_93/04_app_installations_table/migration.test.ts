// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_93/04_app_installations_table';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (the legacy table is
// empty), down walking the populated target table (`downTable`) and restoring
// the seed digest byte-for-byte, and the ledger transitions.
defineMigrationTest({
  id: '0.2.93/04_app_installations_table',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // Post-0.2.93/01 shape: the slug/name renames already ran.
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      automationSlug: 'inbox',
      automationName: 'Inbox',
      installedAt: 1,
      installedBy: 'user',
      status: 'active',
      requiredIntegrations: [],
      resources: [],
    });
  },

  async expectUp(world) {
    expect(
      await world.run((ctx) => ctx.db.query('appInstallations').collect()),
    ).toHaveLength(0);
    const target = (await world.run((ctx) =>
      ctx.db.query('automationInstallations').collect(),
    )) as Array<Record<string, unknown>>;
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      organizationId: ORG,
      automationSlug: 'inbox',
      automationName: 'Inbox',
      installedBy: 'user',
      status: 'active',
    });
  },

  cases: {
    'a row already present in the target drops the legacy row without duplicating':
      async (world) => {
        await world.run(async (ctx) => {
          await ctx.db.insert('appInstallations', {
            organizationId: ORG,
            automationSlug: 'digest',
            installedAt: 2,
            installedBy: 'user',
            status: 'active',
            requiredIntegrations: [],
            resources: [],
          });
          await ctx.db.insert('automationInstallations', {
            organizationId: ORG,
            automationSlug: 'digest',
            installedAt: 2,
            installedBy: 'user',
            status: 'active',
            requiredIntegrations: [],
            resources: [],
          });
        });

        await world.applyUpOnly();

        expect(
          await world.run((ctx) => ctx.db.query('appInstallations').collect()),
        ).toHaveLength(0);
        const target = (await world.run((ctx) =>
          ctx.db.query('automationInstallations').collect(),
        )) as Array<Record<string, unknown>>;
        expect(
          target.filter((r) => r.automationSlug === 'digest'),
        ).toHaveLength(1);
      },
  },
});
