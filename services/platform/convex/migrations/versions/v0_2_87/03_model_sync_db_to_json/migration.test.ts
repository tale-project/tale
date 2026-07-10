// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_87/03_model_sync_db_to_json';

// Harness ritual: real fleet up (incl. the real configCache sync), handler
// idempotency over migrated state, down restoring the seed digest, ledger.
defineMigrationTest({
  id: '0.2.87/03_model_sync_db_to_json',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    await ctx.db.insert('modelSyncSettings', {
      organizationId: orgs[0].id,
      autoSyncEnabled: false,
    });
    // org2 seeds nothing: the per-org no-op path (no legacy row → no file).
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const file = (slug: string) =>
      path.join(world.configRoot, slug, 'governance', 'model-sync.json');

    const written = JSON.parse(await readFile(file(org1.slug), 'utf-8'));
    expect(written).toEqual({ autoSyncEnabled: false });

    // The real file→cache sync mirrored the exported opt-out.
    const cache = await world.run<Array<Record<string, unknown>>>((ctx) =>
      ctx.db.query('configCache').collect(),
    );
    const org1Keys = cache
      .filter(
        (row: Record<string, unknown>) =>
          row.organizationId === org1.id && row.domain === 'governance',
      )
      .map((row: Record<string, unknown>) => row.key);
    expect(org1Keys).toEqual(['model_sync']);

    // org2 had no legacy row — no file appears.
    expect(await readFileSafe(file(org2.slug))).toBeNull();
  },
});
