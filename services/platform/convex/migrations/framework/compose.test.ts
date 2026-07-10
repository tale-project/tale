import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  composeComponent,
  composeDb,
  composeLegacyDb,
  makeDbRun,
} from './compose';
import {
  defineComponentMigration,
  defineDbMigration,
  type DbRun,
} from './define';
import { migrationLedgerTable, migrationSnapshotsTable } from './schema';
import { buildModules } from './test_helpers';
import type { DbMigration, MigrationDoc, MigrationMeta } from './types';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/framework',
);

const fixtureSchema = defineSchema({
  widgets: defineTable({ name: v.string() }),
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
});

function metaOf(id: string): MigrationMeta {
  const [semver, rest] = id.split('/');
  return {
    id,
    semver,
    numericId: Number.parseInt(rest.slice(0, 2), 10),
    slug: rest.slice(3),
    title: 'Test migration',
    description:
      'Snapshot-then-delete widgets so the compose layer run API binding can be observed in a test world.',
    kind: 'db',
    reversible: true,
    destructive: true,
    snapshot: 'table-rows',
  };
}

describe('makeDbRun', () => {
  it('binds snapshot writers to the migration id', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('widgets', { name: 'w1' });
      const doc = (await ctx.db.get(id)) as unknown as MigrationDoc;
      const run = makeDbRun(ctx as never, '9.9.9/01_test');
      expect(run.id).toBe('9.9.9/01_test');
      await run.snapshotRow(`widgets:${String(doc._id)}`, doc);
      await run.snapshotBetterAuthRow('user', { _id: 'u_1', email: 'a@b.c' });

      const snaps = await ctx.db.query('migrationSnapshots').collect();
      expect(snaps).toHaveLength(2);
      expect(snaps.every((s) => s.migrationId === '9.9.9/01_test')).toBe(true);
      const rowSnap = snaps.find((s) => s.scope.startsWith('widgets:'));
      // System fields stripped so the payload can be re-inserted fresh.
      expect(rowSnap?.payload).toEqual({ name: 'w1' });
      const authSnap = snaps.find((s) =>
        s.scope.startsWith('component:betterAuth:user:'),
      );
      expect(authSnap?.scope).toBe('component:betterAuth:user:u_1');
    });
  });
});

describe('composeDb', () => {
  it('injects an id-bound run API and carries table/batchSize', async () => {
    const meta = metaOf('9.9.9/02_snapshot_widgets');
    const module = defineDbMigration({
      title: 'Snapshot and delete widgets',
      description:
        'Backs each widget row up into migrationSnapshots, then deletes it; down is the generic snapshot restore.',
      destructive: true,
      snapshot: 'table-rows',
      subjects: { tables: ['widgets'] },
      table: 'widgets',
      batchSize: 7,
      async up(ctx, doc, run: DbRun) {
        await run.snapshotRow(`widgets:${String(doc._id)}`, doc);
        await ctx.db.delete(doc._id as never);
      },
      async down() {},
    });
    const composed = composeDb(meta, module);
    expect(composed.meta).toBe(meta);
    expect(composed.table).toBe('widgets');
    expect(composed.batchSize).toBe(7);

    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('widgets', { name: 'w2' });
      const doc = (await ctx.db.get(id)) as unknown as MigrationDoc;
      await composed.up(ctx as never, doc);

      expect(await ctx.db.query('widgets').collect()).toHaveLength(0);
      const snaps = await ctx.db.query('migrationSnapshots').collect();
      expect(snaps).toHaveLength(1);
      // The run API stamped the COMPOSED meta id — no hand-threading.
      expect(snaps[0].migrationId).toBe(meta.id);
      expect(snaps[0].payload).toEqual({ name: 'w2' });
    });
  });
});

describe('composeComponent', () => {
  it('threads cursor and batch size through and injects the run API', async () => {
    const meta: MigrationMeta = {
      ...metaOf('9.9.9/03_component'),
      kind: 'component',
      destructive: false,
      snapshot: 'none',
    };
    const seen: Array<{
      cursor: string | null;
      batchSize: number;
      runId: string;
    }> = [];
    const module = defineComponentMigration({
      title: 'Component cursor threading probe',
      description:
        'Records the cursor, batch size, and bound run id the compose layer hands to the handler.',
      destructive: false,
      snapshot: 'none',
      subjects: { tables: ['betterAuth:user'] },
      batchSize: 5,
      async up(_ctx, cursor, batchSize, run) {
        seen.push({ cursor, batchSize, runId: run.id });
        return {
          isDone: true,
          processed: 0,
          renamed: 0,
          merged: 0,
          skipped: 0,
          noop: 0,
          continueCursor: null,
        };
      },
      async down(_ctx, cursor, run) {
        seen.push({ cursor, batchSize: -1, runId: run.id });
        return {
          isDone: true,
          processed: 0,
          renamed: 0,
          merged: 0,
          skipped: 0,
          noop: 0,
          continueCursor: null,
        };
      },
    });
    const composed = composeComponent(meta, module);
    expect(composed.batchSize).toBe(5);

    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await composed.up(ctx as never, 'cur_1', 5);
      await composed.down(ctx as never, null);
    });
    expect(seen).toEqual([
      { cursor: 'cur_1', batchSize: 5, runId: meta.id },
      { cursor: null, batchSize: -1, runId: meta.id },
    ]);
  });
});

describe('legacy passthroughs', () => {
  it('return the runtime object unchanged during the port window', () => {
    const legacy: DbMigration = {
      meta: metaOf('9.9.9/04_legacy'),
      table: 'widgets',
      async up() {},
      async down() {},
    };
    expect(composeLegacyDb(legacy)).toBe(legacy);
  });
});
