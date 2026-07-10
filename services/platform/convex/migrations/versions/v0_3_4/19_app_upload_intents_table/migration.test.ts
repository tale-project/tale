// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_93/07_app_upload_intents_table';
const ORG = 'org_1';

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (the legacy table is
// empty), down walking the populated target table (`downTable`) and restoring
// the seed digest byte-for-byte, and the ledger transitions.
defineMigrationTest({
  id: '0.3.4/19_app_upload_intents_table',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const storageId = await ctx.storage.store(new Blob(['bundle']));
    await ctx.db.insert('appUploadIntents', {
      storageId,
      organizationId: ORG,
      userId: 'user_1',
      createdAt: 1,
    });
  },

  async expectUp(world) {
    expect(
      await world.run((ctx) => ctx.db.query('appUploadIntents').collect()),
    ).toHaveLength(0);
    const target = (await world.run((ctx) =>
      ctx.db.query('automationUploadIntents').collect(),
    )) as Array<Record<string, unknown>>;
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      organizationId: ORG,
      userId: 'user_1',
      createdAt: 1,
    });
    expect(target[0].storageId).toBeDefined();
  },
});
