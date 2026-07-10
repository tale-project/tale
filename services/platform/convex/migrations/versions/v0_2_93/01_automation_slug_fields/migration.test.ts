// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_93/01_automation_slug_fields';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (renamed rows are
// skipped), down restoring the seed digest byte-for-byte (appSlug/appName
// back, automation* fields gone), and the ledger transitions.
defineMigrationTest({
  id: '0.2.93/01_automation_slug_fields',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      appSlug: 'inbox',
      appName: 'Inbox',
      installedAt: 1,
      installedBy: 'user',
      status: 'active',
      requiredIntegrations: [],
      resources: [],
    });
    // A row without the optional appName — only the slug is renamed.
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      appSlug: 'issue-desk',
      installedAt: 2,
      installedBy: 'user',
      status: 'active',
      requiredIntegrations: [],
      resources: [],
    });
  },

  async expectUp(world) {
    const rows = (await world.run((ctx) =>
      ctx.db.query('appInstallations').collect(),
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);

    const inbox = rows.find((r) => r.automationSlug === 'inbox');
    expect(inbox?.automationName).toBe('Inbox');
    expect(inbox?.appSlug).toBeUndefined();
    expect(inbox?.appName).toBeUndefined();

    const desk = rows.find((r) => r.automationSlug === 'issue-desk');
    expect(desk?.automationName).toBeUndefined();
    expect(desk?.appSlug).toBeUndefined();
  },
});
