import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_87/04_drop_org_package_policy';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

async function seedRows(t: ReturnType<typeof convexTest>, n: number) {
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('orgPackagePolicy', {
        organizationId: `org_${i}`,
        defaultMode: 'denylist',
        pythonAllow: [],
        pythonDeny: [`bad_${i}`],
        nodeAllow: [],
        nodeDeny: [],
      });
    }
  });
}

const legacyRows = (
  t: ReturnType<typeof convexTest>,
): Promise<Array<Record<string, unknown>>> =>
  t.run((ctx) =>
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table
    (ctx.db.query('orgPackagePolicy' as any) as any).collect(),
  ) as Promise<Array<Record<string, unknown>>>;

describe('0.2.87/04 drop_org_package_policy', () => {
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
    expect(snaps[0].payload).toMatchObject({ defaultMode: 'denylist' });

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.86',
      only: [meta.id],
    });

    const restored = await legacyRows(t);
    expect(restored).toHaveLength(3);
    expect(restored.map((r) => (r.pythonDeny as string[])[0]).sort()).toEqual([
      'bad_0',
      'bad_1',
      'bad_2',
    ]);
  });
});
