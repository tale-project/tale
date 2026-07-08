import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_90/06_drop_workforce_agent_installations';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

async function seedRows(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'chief-executive-officer',
      installedAt: Date.now(),
      installedBy: 'user_1',
      contentHash: 'hash-ceo',
      enabled: true,
    });
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'analyst',
      installedAt: Date.now(),
      installedBy: 'system',
      contentHash: 'hash-analyst',
      enabled: false,
      disabledReason: 'user',
    });
    await ctx.db.insert('agentInstallations', {
      organizationId: 'org_1',
      agentSlug: 'assistant',
      installedAt: Date.now(),
      installedBy: 'system',
      contentHash: 'hash-assistant',
      enabled: true,
    });
  });
}

const allRows = (
  t: ReturnType<typeof convexTest>,
): Promise<Array<Record<string, unknown>>> =>
  t.run((ctx) => ctx.db.query('agentInstallations').collect()) as Promise<
    Array<Record<string, unknown>>
  >;

describe('0.2.90/06 drop_workforce_agent_installations', () => {
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

  it('up snapshots then deletes persona rows only; down restores them', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedRows(t);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
      allowDestructive: true,
    });

    const remaining = await allRows(t);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].agentSlug).toBe('assistant');

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
    expect(
      restored
        .map((r) => String(r.agentSlug))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['analyst', 'assistant', 'chief-executive-officer']);
  });
});
