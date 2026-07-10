// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_93/06_app_upload_claims_table';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (the legacy table is
// empty), down walking the populated target table (`downTable`) and restoring
// the seed digest byte-for-byte, and the ledger transitions.
defineMigrationTest({
  id: '0.2.93/06_app_upload_claims_table',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('appUploadClaims', {
      organizationId: ORG,
      slug: 'inbox',
      claimedAt: 1,
      expiresAt: 2,
    });
  },

  async expectUp(world) {
    expect(
      await world.run((ctx) => ctx.db.query('appUploadClaims').collect()),
    ).toHaveLength(0);
    const target = (await world.run((ctx) =>
      ctx.db.query('automationUploadClaims').collect(),
    )) as Array<Record<string, unknown>>;
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      organizationId: ORG,
      slug: 'inbox',
      claimedAt: 1,
      expiresAt: 2,
    });
  },
});
