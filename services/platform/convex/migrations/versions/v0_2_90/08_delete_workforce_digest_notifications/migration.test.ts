import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR =
  'migrations/versions/v0_2_90/08_delete_workforce_digest_notifications';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

async function seedRows(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('userNotifications', {
      userId: 'user_1',
      organizationId: 'org_1',
      type: 'workforce_digest',
      titleKey: 'workforceDigest',
      bodyKey: 'workforceDigestBody',
      resourceType: 'dashboard',
      resourceId: 'org_1',
      actorType: 'system',
      read: false,
      createdAt: Date.now(),
    });
    await ctx.db.insert('userNotifications', {
      userId: 'user_2',
      organizationId: 'org_1',
      type: 'workforce_digest',
      titleKey: 'workforceDigest',
      bodyKey: 'workforceDigestBody',
      resourceType: 'dashboard',
      resourceId: 'org_1',
      actorType: 'system',
      read: true,
      readAt: Date.now(),
      createdAt: Date.now(),
    });
    await ctx.db.insert('userNotifications', {
      userId: 'user_1',
      organizationId: 'org_1',
      type: 'task_assigned',
      titleKey: 'taskAssigned',
      bodyKey: 'taskAssignedBody',
      resourceType: 'task',
      resourceId: 'task_1',
      actorType: 'user',
      read: false,
      createdAt: Date.now(),
    });
  });
}

const allRows = (
  t: ReturnType<typeof convexTest>,
): Promise<Array<Record<string, unknown>>> =>
  t.run((ctx) => ctx.db.query('userNotifications').collect()) as Promise<
    Array<Record<string, unknown>>
  >;

describe('0.2.90/08 delete_workforce_digest_notifications', () => {
  it('is skipped by applyUp unless destructive is accepted', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedRows(t);

    const res = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [meta.id] },
    );
    expect(res.completed).toEqual([]);
    expect(res.skipped.map((m) => m.id)).toContain(meta.id);
    expect(await allRows(t)).toHaveLength(3);
  });

  it('up snapshots then deletes digest rows only; down restores them', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedRows(t);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
      allowDestructive: true,
    });

    const remaining = await allRows(t);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe('task_assigned');

    const snaps = await t.run((ctx) =>
      ctx.db
        .query('migrationSnapshots')
        .withIndex('by_migration', (q) => q.eq('migrationId', meta.id))
        .collect(),
    );
    expect(snaps).toHaveLength(2);

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.89',
      only: [meta.id],
    });

    const restored = await allRows(t);
    expect(restored).toHaveLength(3);
    expect(restored.filter((r) => r.type === 'workforce_digest')).toHaveLength(
      2,
    );
  });
});
