import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { components, internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import betterAuthSchema from '../../betterAuth/schema';
import { migrationLedgerTable, migrationSnapshotsTable } from './schema';
import { buildOrderKey } from './semver';
import { buildModules } from './test_helpers';
import type { DbMigration, MigrationDoc, MigrationMeta } from './types';

const h = vi.hoisted(() => {
  const mkMeta = (id: string): MigrationMeta => {
    const [semver, rest] = id.split('/');
    return {
      id,
      semver,
      numericId: Number.parseInt(rest.slice(0, 2), 10),
      slug: rest.slice(3),
      title: `Synthetic ${rest.slice(3)}`,
      description:
        'Synthetic db migration fixture exercising the batch runner primitives over a small fixture table.',
      kind: 'db',
      reversible: true,
      destructive: false,
      snapshot: 'none',
    };
  };

  const MARK_ID = '9.9.9/01_mark';
  const BOOM_ID = '9.9.9/02_boom';
  const RESTORE_ID = '9.9.9/03_restore';

  const dbMigrations: Record<string, DbMigration> = {
    [MARK_ID]: {
      meta: mkMeta(MARK_ID),
      table: 'items',
      batchSize: 2,
      up: async (ctx: MutationCtx, doc: MigrationDoc): Promise<void> => {
        await ctx.db.patch(doc._id as never, { migrated: true } as never);
      },
      down: async (ctx: MutationCtx, doc: MigrationDoc): Promise<void> => {
        await ctx.db.patch(doc._id as never, { migrated: false } as never);
      },
    },
    [BOOM_ID]: {
      meta: mkMeta(BOOM_ID),
      table: 'items',
      batchSize: 5,
      up: async (ctx: MutationCtx, doc: MigrationDoc): Promise<void> => {
        if (doc.n === 3) throw new Error('boom on the 3rd row');
        await ctx.db.patch(doc._id as never, { marked: true } as never);
      },
      down: async (): Promise<void> => {},
    },
    [RESTORE_ID]: {
      meta: {
        ...mkMeta(RESTORE_ID),
        destructive: true,
        snapshot: 'table-rows',
      },
      table: 'items',
      batchSize: 2,
      up: async (): Promise<void> => {},
      down: async (): Promise<void> => {},
    },
  };

  const allMeta: readonly MigrationMeta[] = Object.values(dbMigrations).map(
    (m) => m.meta,
  );

  return { MARK_ID, BOOM_ID, RESTORE_ID, dbMigrations, allMeta };
});

vi.mock('./registry.gen', () => ({
  ALL_META: h.allMeta,
  DB_MIGRATIONS: h.dbMigrations,
  COMPONENT_MIGRATIONS: {},
  requireMeta: (id: string) => {
    const meta = h.allMeta.find((m) => m.id === id);
    if (!meta) throw new Error(`Unknown migration id: ${id}`);
    return meta;
  },
}));

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/framework',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

const fixtureSchema = defineSchema({
  items: defineTable({
    n: v.number(),
    migrated: v.optional(v.boolean()),
    marked: v.optional(v.boolean()),
    origId: v.optional(v.string()),
  }),
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
});

function newWorld() {
  return convexTest(fixtureSchema, modules);
}

async function beginRun(
  t: ReturnType<typeof newWorld>,
  migrationId: string,
  direction: 'up' | 'down',
) {
  const [semver, rest] = migrationId.split('/');
  const numericId = Number.parseInt(rest.slice(0, 2), 10);
  return await t.mutation(internal.migrations.framework.ledger.beginRun, {
    migrationId,
    semver,
    numericId,
    orderKey: buildOrderKey(semver, numericId),
    direction,
  });
}

async function ledgerRow(t: ReturnType<typeof newWorld>, migrationId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('migrationLedger')
      .withIndex('by_migrationId', (q) => q.eq('migrationId', migrationId))
      .unique();
  });
}

describe('runner.applyDbBatch', () => {
  it('paginates at batchSize, persists the cursor per batch, and nulls it when done', async () => {
    const t = newWorld();
    await t.run(async (ctx) => {
      for (let n = 0; n < 5; n++) await ctx.db.insert('items', { n });
    });
    await beginRun(t, h.MARK_ID, 'up');

    const b1 = await t.mutation(
      internal.migrations.framework.runner.applyDbBatch,
      { migrationId: h.MARK_ID, direction: 'up' },
    );
    expect(b1).toEqual({ isDone: false, processed: 2 });
    const cursor1 = (await ledgerRow(t, h.MARK_ID))?.cursor;
    expect(typeof cursor1).toBe('string');

    const b2 = await t.mutation(
      internal.migrations.framework.runner.applyDbBatch,
      { migrationId: h.MARK_ID, direction: 'up' },
    );
    expect(b2).toEqual({ isDone: false, processed: 2 });
    const cursor2 = (await ledgerRow(t, h.MARK_ID))?.cursor;
    expect(typeof cursor2).toBe('string');
    expect(cursor2).not.toBe(cursor1);

    const b3 = await t.mutation(
      internal.migrations.framework.runner.applyDbBatch,
      { migrationId: h.MARK_ID, direction: 'up' },
    );
    expect(b3).toEqual({ isDone: true, processed: 1 });
    expect((await ledgerRow(t, h.MARK_ID))?.cursor).toBeNull();

    const items = await t.run((ctx) => ctx.db.query('items').collect());
    expect(items.every((i) => i.migrated === true)).toBe(true);
  });

  it("invokes the inverse transform for direction 'down'", async () => {
    const t = newWorld();
    await t.run(async (ctx) => {
      await ctx.db.insert('items', { n: 0, migrated: true });
      await ctx.db.insert('items', { n: 1, migrated: true });
    });
    await beginRun(t, h.MARK_ID, 'down');

    const batch = await t.mutation(
      internal.migrations.framework.runner.applyDbBatch,
      { migrationId: h.MARK_ID, direction: 'down' },
    );
    expect(batch).toEqual({ isDone: true, processed: 2 });

    const items = await t.run((ctx) => ctx.db.query('items').collect());
    expect(items.every((i) => i.migrated === false)).toBe(true);
  });

  it('rejects an unknown migration id', async () => {
    const t = newWorld();
    await expect(
      t.mutation(internal.migrations.framework.runner.applyDbBatch, {
        migrationId: '0.0.0/99_nope',
        direction: 'up',
      }),
    ).rejects.toThrow(/Unknown db migration: 0\.0\.0\/99_nope/);
  });

  it('rejects when the migration has no ledger row', async () => {
    const t = newWorld();
    await expect(
      t.mutation(internal.migrations.framework.runner.applyDbBatch, {
        migrationId: h.MARK_ID,
        direction: 'up',
      }),
    ).rejects.toThrow(/No ledger row for running migration/);
  });

  it('rolls back the whole batch when one row throws, leaving rows and cursor untouched', async () => {
    const t = newWorld();
    await t.run(async (ctx) => {
      for (let n = 1; n <= 5; n++) await ctx.db.insert('items', { n });
    });
    await beginRun(t, h.BOOM_ID, 'up');

    // Rows 1 and 2 are patched before row 3 throws — the mutation transaction
    // must discard those writes along with the cursor patch.
    await expect(
      t.mutation(internal.migrations.framework.runner.applyDbBatch, {
        migrationId: h.BOOM_ID,
        direction: 'up',
      }),
    ).rejects.toThrow(/boom on the 3rd row/);

    const items = await t.run((ctx) => ctx.db.query('items').collect());
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.marked === undefined)).toBe(true);
    expect((await ledgerRow(t, h.BOOM_ID))?.cursor).toBeNull();
  });
});

describe('runner.restoreSnapshotBatch', () => {
  it('re-inserts snapshot payloads with fresh ids, consumes snapshots, and advances the cursor', async () => {
    const t = newWorld();
    // Simulate a destructive up: capture original ids in the payloads, then
    // leave the table empty and the snapshots behind.
    await t.run(async (ctx) => {
      for (let n = 0; n < 3; n++) {
        const id = await ctx.db.insert('items', { n });
        await ctx.db.delete(id);
        await ctx.db.insert('migrationSnapshots', {
          migrationId: h.RESTORE_ID,
          scope: `items:${String(id)}`,
          payload: { n, origId: String(id) },
          createdAt: Date.now(),
        });
      }
    });
    await beginRun(t, h.RESTORE_ID, 'down');

    const r1 = await t.mutation(
      internal.migrations.framework.runner.restoreSnapshotBatch,
      { migrationId: h.RESTORE_ID },
    );
    expect(r1).toEqual({ isDone: false, processed: 2 });
    expect(typeof (await ledgerRow(t, h.RESTORE_ID))?.cursor).toBe('string');

    const r2 = await t.mutation(
      internal.migrations.framework.runner.restoreSnapshotBatch,
      { migrationId: h.RESTORE_ID },
    );
    expect(r2).toEqual({ isDone: true, processed: 1 });
    expect((await ledgerRow(t, h.RESTORE_ID))?.cursor).toBeNull();

    // All snapshots consumed.
    expect(
      await t.run((ctx) => ctx.db.query('migrationSnapshots').collect()),
    ).toHaveLength(0);

    // Every payload re-inserted — with a FRESH _id (Convex cannot re-use one).
    const items = await t.run((ctx) => ctx.db.query('items').collect());
    expect(items.map((i) => i.n).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    for (const item of items) {
      expect(item.origId).toBeDefined();
      expect(String(item._id)).not.toBe(item.origId);
    }
  });

  it('rejects an unknown migration id and a missing ledger row', async () => {
    const t = newWorld();
    await expect(
      t.mutation(internal.migrations.framework.runner.restoreSnapshotBatch, {
        migrationId: '0.0.0/99_nope',
      }),
    ).rejects.toThrow(/Unknown db migration/);
    await expect(
      t.mutation(internal.migrations.framework.runner.restoreSnapshotBatch, {
        migrationId: h.RESTORE_ID,
      }),
    ).rejects.toThrow(/No ledger row for running migration/);
  });
});

describe('runner.restoreComponentSnapshotBatch', () => {
  it('recreates allowed models in the real component, skips others, and consumes the snapshots', async () => {
    const t = newWorld();
    t.registerComponent('betterAuth', betterAuthSchema, authModules);

    // Any id works: this batch primitive never consults the registry.
    const COMP_ID = '9.9.9/04_component_restore';
    await t.run(async (ctx) => {
      await ctx.db.insert('migrationSnapshots', {
        migrationId: COMP_ID,
        scope: 'component:betterAuth:user:legacy_user_1',
        payload: {
          _id: 'legacy_user_1',
          _creationTime: 999,
          name: 'Dup User',
          email: 'dup@example.com',
          emailVerified: true,
          createdAt: 1,
          updatedAt: 1,
        },
        createdAt: Date.now(),
      });
      // Non-allowed model: consumed but never recreated.
      await ctx.db.insert('migrationSnapshots', {
        migrationId: COMP_ID,
        scope: 'component:betterAuth:organization:legacy_org_1',
        payload: {
          _id: 'legacy_org_1',
          name: 'Legacy',
          slug: 'legacy-org',
          createdAt: 1,
        },
        createdAt: Date.now(),
      });
    });
    await beginRun(t, COMP_ID, 'down');

    const result = await t.mutation(
      internal.migrations.framework.runner.restoreComponentSnapshotBatch,
      { migrationId: COMP_ID },
    );
    expect(result).toEqual({ isDone: true, processed: 2 });
    expect((await ledgerRow(t, COMP_ID))?.cursor).toBeNull();

    // Both component-scoped snapshots consumed.
    expect(
      await t.run((ctx) => ctx.db.query('migrationSnapshots').collect()),
    ).toHaveLength(0);

    // The user row exists in the real component. adapter.create validates its
    // input exactly, so the call succeeding at all proves _id/_creationTime
    // were stripped; the restored row carries a fresh component id.
    const users = await t.run(async (ctx) => {
      return await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 10 },
        where: [],
      });
    });
    expect(users.page).toHaveLength(1);
    expect(users.page[0]).toMatchObject({
      name: 'Dup User',
      email: 'dup@example.com',
      emailVerified: true,
    });
    expect(users.page[0]._id).not.toBe('legacy_user_1');

    // The organization snapshot was NOT recreated.
    const orgs = await t.run(async (ctx) => {
      return await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'organization',
        paginationOpts: { cursor: null, numItems: 10 },
        where: [],
      });
    });
    expect(orgs.page).toHaveLength(0);
  });
});
