import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_87/05_drop_model_sync_settings';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

async function seedRows(t: ReturnType<typeof convexTest>, n: number) {
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('modelSyncSettings', {
        organizationId: `org_${i}`,
        autoSyncEnabled: i % 2 === 0,
      });
    }
  });
}

const legacyRows = (
  t: ReturnType<typeof convexTest>,
): Promise<Array<Record<string, unknown>>> =>
  t.run((ctx) =>
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table
    (ctx.db.query('modelSyncSettings' as any) as any).collect(),
  ) as Promise<Array<Record<string, unknown>>>;

describe('0.2.87/05 drop_model_sync_settings', () => {
  it('is skipped by applyUp unless destructive is accepted', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedRows(t, 2);

    const res = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [meta.id] },
    );
    expect(res.completed).toEqual([]);
    expect(res.skipped.map((m) => m.id)).toContain(meta.id);
    expect(await legacyRows(t)).toHaveLength(2);
  });

  it('up snapshots then deletes; down restores from the snapshot', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedRows(t, 3);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
      allowDestructive: true,
    });
    expect(await legacyRows(t)).toHaveLength(0);

    const snaps = await t.run((ctx) =>
      ctx.db
        .query('migrationSnapshots')
        .withIndex('by_migration', (q) => q.eq('migrationId', meta.id))
        .collect(),
    );
    expect(snaps).toHaveLength(3);

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.86',
      only: [meta.id],
    });

    expect(await legacyRows(t)).toHaveLength(3);
  });
});
