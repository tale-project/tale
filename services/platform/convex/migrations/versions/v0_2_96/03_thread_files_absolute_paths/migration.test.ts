// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import type { WorldSeedCtx } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_89/02_thread_files_absolute_paths';
const ORG = 'org_tf';
const THREAD = 'thr_1';

async function insertFile(
  ctx: WorldSeedCtx,
  path: string,
  source: 'user_upload' | 'agent_write' | 'run_output',
): Promise<void> {
  const storageId = await ctx.storage.store(new Blob(['x']));
  await ctx.db.insert('threadFiles', {
    organizationId: ORG,
    threadId: THREAD,
    path,
    storageId,
    size: 1,
    contentType: 'text/plain',
    source,
    createdAt: 0,
    updatedAt: 0,
  });
}

async function pathBySource(world: {
  run<T>(fn: (ctx: WorldSeedCtx) => Promise<T>): Promise<T>;
}): Promise<Record<string, string>> {
  const rows = await world.run((ctx) => ctx.db.query('threadFiles').collect());
  const out: Record<string, string> = {};
  for (const row of rows as Array<Record<string, unknown>>) {
    out[String(row.source)] = String(row.path);
  }
  return out;
}

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (roots stripped again), and the ledger
// transitions. Only RELATIVE paths are seeded here: down strips the root from
// ANY absolute row, so a seeded already-absolute row could not round-trip —
// that idempotency edge lives in the case below.
defineMigrationTest({
  id: '0.2.96/03_thread_files_absolute_paths',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await insertFile(ctx, 'a.csv', 'user_upload');
    await insertFile(ctx, 'gen.py', 'agent_write');
    await insertFile(ctx, 'report.pptx', 'run_output');
  },

  async expectUp(world) {
    // Each source maps onto its own root.
    expect(await pathBySource(world)).toEqual({
      user_upload: '/user/uploads/a.csv',
      agent_write: '/user/code/gen.py',
      run_output: '/user/output/report.pptx',
    });
  },

  cases: {
    'up leaves an already-absolute path untouched': async (world) => {
      await world.run(async (ctx) => {
        await insertFile(ctx, '/user/output/x.txt', 'run_output');
      });

      await world.applyUpOnly();

      const rows = await world.run((ctx) =>
        ctx.db.query('threadFiles').collect(),
      );
      const already = (rows as Array<Record<string, unknown>>).find(
        (r) => r.path === '/user/output/x.txt',
      );
      expect(already).toBeDefined();
    },
  },
});
