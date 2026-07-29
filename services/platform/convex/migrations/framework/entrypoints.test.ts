import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import { internalQuery } from '../../_generated/server';
import type { MutationCtx } from '../../_generated/server';
import betterAuthSchema from '../../betterAuth/schema';
import { resetLimits, setLimitsForTest } from './limits';
import { migrationLedgerTable, migrationSnapshotsTable } from './schema';
import { buildOrderKey } from './semver';
import { buildModules } from './test_helpers';
import type {
  DbMigration,
  MigrationDoc,
  MigrationKind,
  MigrationMeta,
  MigrationOrg,
  NodeMigration,
  NodeMigrationCtx,
} from './types';

const h = vi.hoisted(() => {
  const state = {
    /** One-shot fuse for the db crash/resume scenario. */
    dbCrashed: false,
    /** One-shot fuse + distinct-org tracking for the node fleet scenario. */
    fleetCrashed: false,
    fleetSeen: new Set<string>(),
    fleetCalls: new Map<string, number>(),
    /** Distinct invocations of the stuck-cursor probe migration. */
    stuckRuns: 0,
  };
  const reset = () => {
    state.dbCrashed = false;
    state.fleetCrashed = false;
    state.fleetSeen.clear();
    state.fleetCalls.clear();
    state.stuckRuns = 0;
  };

  const mkMeta = (
    id: string,
    kind: MigrationKind,
    opts: {
      destructive?: boolean;
      snapshot?: MigrationMeta['snapshot'];
      formerIds?: string[];
    } = {},
  ): MigrationMeta => {
    const [semver, rest] = id.split('/');
    return {
      id,
      semver,
      numericId: Number.parseInt(rest.slice(0, 2), 10),
      slug: rest.slice(3),
      title: `Synthetic ${rest.slice(3)}`,
      description:
        'Synthetic migration fixture driving the entrypoints orchestration; it never touches a production data shape.',
      kind,
      reversible: true,
      destructive: opts.destructive ?? false,
      snapshot: opts.snapshot ?? 'none',
      ...(opts.formerIds ? { formerIds: opts.formerIds } : {}),
    };
  };

  const EARLY_ID = '9.9.7/01_early';
  const REF_ID = '9.9.7/02_ref';
  const SAFE1_ID = '9.9.8/01_safe1';
  const DESTR_ID = '9.9.8/02_destr';
  const SAFE2_ID = '9.9.8/03_safe2';
  const TOUCH_ID = '9.9.9/01_touch';
  const CAPPED_ID = '9.9.9/02_capped';
  const FLEET_ID = '9.9.9/03_fleet';
  const STUCK_ID = '9.9.9/04_stuck';
  const PAGES_ID = '9.9.9/05_pages';
  /** Re-homed migration: shipped as FORMER_ID, now lives at RENAMED_ID. */
  const RENAMED_ID = '9.9.9/06_renamed';
  const FORMER_ID = '9.9.6/01_original';

  const noopDb = (
    id: string,
    opts: { destructive?: boolean } = {},
  ): DbMigration => ({
    meta: mkMeta(id, 'db', opts),
    table: 'items',
    up: async (): Promise<void> => {},
    down: async (): Promise<void> => {},
  });

  const dbMigrations: Record<string, DbMigration> = {
    [EARLY_ID]: noopDb(EARLY_ID),
    [SAFE1_ID]: noopDb(SAFE1_ID),
    [DESTR_ID]: noopDb(DESTR_ID, { destructive: true }),
    [SAFE2_ID]: noopDb(SAFE2_ID),
    [TOUCH_ID]: {
      meta: mkMeta(TOUCH_ID, 'db'),
      table: 'items',
      batchSize: 10,
      up: async (ctx: MutationCtx, doc: MigrationDoc): Promise<void> => {
        if (doc.n === 25 && !state.dbCrashed) {
          state.dbCrashed = true;
          throw new Error('injected crash at n=25');
        }
        // Idempotency guard: a replayed, already-transformed row is a no-op.
        if (doc.migrated === true) return;
        const touches = typeof doc.touches === 'number' ? doc.touches : 0;
        await ctx.db.patch(
          doc._id as never,
          { migrated: true, touches: touches + 1 } as never,
        );
      },
      down: async (): Promise<void> => {},
    },
    [CAPPED_ID]: {
      ...noopDb(CAPPED_ID),
      batchSize: 1,
    },
    [RENAMED_ID]: {
      meta: mkMeta(RENAMED_ID, 'db', {
        snapshot: 'table-rows',
        formerIds: [FORMER_ID],
      }),
      table: 'items',
      up: async (): Promise<void> => {},
      down: async (): Promise<void> => {},
    },
  };

  const countFleetOrg = (org: MigrationOrg): void => {
    state.fleetCalls.set(org.id, (state.fleetCalls.get(org.id) ?? 0) + 1);
    if (!state.fleetSeen.has(org.id)) {
      state.fleetSeen.add(org.id);
      if (state.fleetSeen.size === 120 && !state.fleetCrashed) {
        state.fleetCrashed = true;
        throw new Error('injected fleet crash on the 120th org');
      }
    }
  };

  const nodeMigrations: Record<string, NodeMigration> = {
    [FLEET_ID]: {
      meta: mkMeta(FLEET_ID, 'node'),
      up: async (_ctx: NodeMigrationCtx, org: MigrationOrg): Promise<void> => {
        countFleetOrg(org);
      },
      down: async (): Promise<void> => {},
    },
    [STUCK_ID]: {
      meta: mkMeta(STUCK_ID, 'node'),
      up: async (): Promise<void> => {
        state.stuckRuns += 1;
      },
      down: async (): Promise<void> => {},
    },
    [PAGES_ID]: {
      meta: mkMeta(PAGES_ID, 'node'),
      up: async (): Promise<void> => {},
      down: async (): Promise<void> => {},
    },
  };

  const allMeta: readonly MigrationMeta[] = [
    ...Object.values(dbMigrations).map((m) => m.meta),
    mkMeta(REF_ID, 'reference'),
    ...Object.values(nodeMigrations).map((m) => m.meta),
  ];

  return {
    state,
    reset,
    allMeta,
    dbMigrations,
    nodeMigrations,
    ids: {
      EARLY_ID,
      REF_ID,
      SAFE1_ID,
      DESTR_ID,
      SAFE2_ID,
      TOUCH_ID,
      CAPPED_ID,
      FLEET_ID,
      STUCK_ID,
      PAGES_ID,
      RENAMED_ID,
      FORMER_ID,
    },
  };
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

vi.mock('./registry.node.gen', () => ({ NODE_MIGRATIONS: h.nodeMigrations }));

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/framework',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

const ORG_SOURCE_KEY = 'migrations/framework/org_source.ts';

/** Fake org source whose cursor never advances (page repeats forever). */
const stuckOrgSource = {
  listOrgsPage: internalQuery({
    args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
    returns: v.object({
      page: v.array(v.object({ id: v.string(), slug: v.string() })),
      continueCursor: v.union(v.string(), v.null()),
      isDone: v.boolean(),
    }),
    handler: async () => ({
      page: [{ id: 'org_stuck_1', slug: 'org1' }],
      continueCursor: 'stuck-cursor',
      isDone: false,
    }),
  }),
};

/** Fake org source that always advances its cursor but never finishes. */
let advancingCalls = 0;
const advancingOrgSource = {
  listOrgsPage: internalQuery({
    args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
    returns: v.object({
      page: v.array(v.object({ id: v.string(), slug: v.string() })),
      continueCursor: v.union(v.string(), v.null()),
      isDone: v.boolean(),
    }),
    handler: async () => {
      advancingCalls += 1;
      return {
        page: [],
        continueCursor: `cursor-${advancingCalls}`,
        isDone: false,
      };
    },
  }),
};

const fixtureSchema = defineSchema({
  items: defineTable({
    n: v.number(),
    migrated: v.optional(v.boolean()),
    touches: v.optional(v.number()),
  }),
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
});

function newWorld(moduleMap: typeof modules = modules) {
  return convexTest(fixtureSchema, moduleMap);
}

async function ledgerRow(t: ReturnType<typeof newWorld>, migrationId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('migrationLedger')
      .withIndex('by_migrationId', (q) => q.eq('migrationId', migrationId))
      .unique();
  });
}

beforeEach(() => {
  h.reset();
  advancingCalls = 0;
});

afterEach(() => {
  resetLimits();
});

describe('entrypoints.planUp', () => {
  it('orders pending migrations, honors the inclusive to bound, and excludes reference kinds', async () => {
    const t = newWorld();

    const all = await t.query(
      internal.migrations.framework.entrypoints.planUp,
      {},
    );
    expect(all.map((m) => m.id)).toEqual([
      h.ids.EARLY_ID,
      h.ids.SAFE1_ID,
      h.ids.DESTR_ID,
      h.ids.SAFE2_ID,
      h.ids.TOUCH_ID,
      h.ids.CAPPED_ID,
      h.ids.FLEET_ID,
      h.ids.STUCK_ID,
      h.ids.PAGES_ID,
      h.ids.RENAMED_ID,
    ]);

    // `to` is inclusive: migrations AT 9.9.8 stay in the plan; 9.9.9 drops out.
    const bounded = await t.query(
      internal.migrations.framework.entrypoints.planUp,
      { to: '9.9.8' },
    );
    expect(bounded.map((m) => m.id)).toEqual([
      h.ids.EARLY_ID,
      h.ids.SAFE1_ID,
      h.ids.DESTR_ID,
      h.ids.SAFE2_ID,
    ]);

    const lowest = await t.query(
      internal.migrations.framework.entrypoints.planUp,
      { to: '9.9.7' },
    );
    // The reference migration shares 9.9.7 but is never plannable.
    expect(lowest.map((m) => m.id)).toEqual([h.ids.EARLY_ID]);
  });
});

describe('entrypoints.preBaselineLedger (breaking-cutover sentinel)', () => {
  async function seedLedgerRow(
    t: ReturnType<typeof newWorld>,
    migrationId: string,
    semver: string,
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert('migrationLedger', {
        migrationId,
        semver,
        numericId: 1,
        orderKey: buildOrderKey(semver, 1),
        direction: 'up',
        status: 'applied',
        cursor: null,
        orgCursor: null,
        processedOrgs: [],
      });
    });
  }

  it('reports a clean slate on an empty ledger (fresh deploy)', async () => {
    const t = newWorld();
    const res = await t.query(
      internal.migrations.framework.entrypoints.preBaselineLedger,
      {},
    );
    expect(res.count).toBe(0);
    expect(res.examples).toEqual([]);
  });

  it('detects ledger rows stamped by pre-baseline releases', async () => {
    const t = newWorld();
    // A 0.3-era deployment: chain rows below the baseline…
    await seedLedgerRow(t, '0.2.84/01_old', '0.2.84');
    await seedLedgerRow(t, '0.3.4/07_older', '0.3.4');
    // …and a post-baseline row that must NOT count.
    await seedLedgerRow(t, '9.9.9/01_future', '9.9.9');

    const res = await t.query(
      internal.migrations.framework.entrypoints.preBaselineLedger,
      {},
    );
    expect(res.count).toBe(2);
    expect(res.examples).toEqual(['0.2.84/01_old', '0.3.4/07_older']);
    expect(res.baseline).toBe('0.4.0');
  });
});

describe('entrypoints.applyUp', () => {
  it('restricts to `only`, applies it, and removes it from the pending plan', async () => {
    const t = newWorld();
    const result = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [h.ids.SAFE2_ID] },
    );
    expect(result).toMatchObject({
      dryRun: false,
      completed: [h.ids.SAFE2_ID],
      skipped: [],
    });
    expect((await ledgerRow(t, h.ids.SAFE2_ID))?.status).toBe('applied');

    const pending = await t.query(
      internal.migrations.framework.entrypoints.planUp,
      {},
    );
    expect(pending.map((m) => m.id)).not.toContain(h.ids.SAFE2_ID);
    // `only` really restricted the run: its siblings are still pending.
    expect(pending.map((m) => m.id)).toContain(h.ids.SAFE1_ID);
  });

  it('stops at the first destructive migration without allowDestructive', async () => {
    const t = newWorld();
    const result = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [h.ids.SAFE1_ID, h.ids.DESTR_ID, h.ids.SAFE2_ID] },
    );
    expect(result.completed).toEqual([h.ids.SAFE1_ID]);
    // Everything from the destructive step onward is skipped, in plan order.
    expect(result.skipped.map((m) => m.id)).toEqual([
      h.ids.DESTR_ID,
      h.ids.SAFE2_ID,
    ]);
    // Skipped migrations never began: no ledger rows.
    expect(await ledgerRow(t, h.ids.DESTR_ID)).toBeNull();
    expect(await ledgerRow(t, h.ids.SAFE2_ID)).toBeNull();
  });

  it('runs the whole plan with allowDestructive', async () => {
    const t = newWorld();
    const result = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      {
        only: [h.ids.SAFE1_ID, h.ids.DESTR_ID, h.ids.SAFE2_ID],
        allowDestructive: true,
      },
    );
    expect(result.completed).toEqual([
      h.ids.SAFE1_ID,
      h.ids.DESTR_ID,
      h.ids.SAFE2_ID,
    ]);
    expect(result.skipped).toEqual([]);
    expect((await ledgerRow(t, h.ids.DESTR_ID))?.status).toBe('applied');
  });

  it('resumes a crashed db migration from the committed cursor without re-transforming rows', async () => {
    const t = newWorld();
    await t.run(async (ctx) => {
      for (let n = 0; n < 30; n++) await ctx.db.insert('items', { n });
    });

    // Attempt 1: batches [0..9] and [10..19] commit; the batch [20..29]
    // throws on n=25 and rolls back whole.
    await expect(
      t.action(internal.migrations.framework.entrypoints.applyUp, {
        only: [h.ids.TOUCH_ID],
      }),
    ).rejects.toThrow(/injected crash at n=25/);

    const failed = await ledgerRow(t, h.ids.TOUCH_ID);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('injected crash at n=25');
    // The failure surfaces on the status wire for operator triage.
    const statusAfterCrash = await t.query(
      internal.migrations.framework.entrypoints.status,
      {},
    );
    expect(statusAfterCrash.failed.map((m: { id: string }) => m.id)).toContain(
      h.ids.TOUCH_ID,
    );
    expect(statusAfterCrash.failedErrors[h.ids.TOUCH_ID]).toContain(
      'injected crash at n=25',
    );
    // The cursor sits at the end of batch 2 — rows 0..19 are committed…
    expect(typeof failed?.cursor).toBe('string');
    const afterCrash = await t.run((ctx) => ctx.db.query('items').collect());
    const transformed = afterCrash.filter((i) => i.migrated === true);
    expect(transformed.map((i) => i.n).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, n) => n),
    );
    // …and the crashed batch's rows were rolled back untouched.
    expect(
      afterCrash
        .filter((i) => i.n >= 20)
        .every((i) => i.migrated === undefined),
    ).toBe(true);

    // Attempt 2 resumes from the cursor and completes.
    const retry = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [h.ids.TOUCH_ID] },
    );
    expect(retry.completed).toEqual([h.ids.TOUCH_ID]);
    expect((await ledgerRow(t, h.ids.TOUCH_ID))?.status).toBe('applied');

    // Every row was transformed exactly once: rows 0..19 were never re-read
    // (cursor resume) and the replayed batch re-transformed only clean rows.
    const items = await t.run((ctx) => ctx.db.query('items').collect());
    expect(items).toHaveLength(30);
    expect(items.every((i) => i.migrated === true)).toBe(true);
    expect(items.every((i) => i.touches === 1)).toBe(true);
  });

  it('fails when a db migration exceeds maxBatches', async () => {
    setLimitsForTest({ maxBatches: 3 });
    const t = newWorld();
    await t.run(async (ctx) => {
      // batchSize 1 over 5 rows can never drain within 3 batches.
      for (let n = 0; n < 5; n++) await ctx.db.insert('items', { n });
    });

    await expect(
      t.action(internal.migrations.framework.entrypoints.applyUp, {
        only: [h.ids.CAPPED_ID],
      }),
    ).rejects.toThrow(/exceeded 3 batches/);

    const row = await ledgerRow(t, h.ids.CAPPED_ID);
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('exceeded 3 batches');
  });
});

describe('entrypoints reference-kind guard', () => {
  it('never plans a reference migration up and refuses to roll one back', async () => {
    const t = newWorld();
    // Force the only reachable path to runOne for a reference kind: a ledger
    // row claims it applied, then a rollback plan picks it up.
    await t.run(async (ctx) => {
      await ctx.db.insert('migrationLedger', {
        migrationId: h.ids.REF_ID,
        semver: '9.9.7',
        numericId: 2,
        orderKey: buildOrderKey('9.9.7', 2),
        direction: 'up',
        status: 'applied',
        cursor: null,
        orgCursor: null,
        processedOrgs: [],
      });
    });

    // Still unplannable up, even while "applied" rows exist around it.
    const pending = await t.query(
      internal.migrations.framework.entrypoints.planUp,
      {},
    );
    expect(pending.map((m) => m.id)).not.toContain(h.ids.REF_ID);

    await expect(
      t.action(internal.migrations.framework.entrypoints.applyDown, {
        to: '9.9.6',
        only: [h.ids.REF_ID],
      }),
    ).rejects.toThrow(/is not runnable/);
    // The guard fires before beginRun: the row is left as it was.
    expect((await ledgerRow(t, h.ids.REF_ID))?.status).toBe('applied');
  });
});

describe('entrypoints node fleet', () => {
  it(
    'resumes a crashed node migration without re-processing completed orgs',
    { timeout: 120_000 },
    async () => {
      const t = newWorld();
      t.registerComponent('betterAuth', betterAuthSchema, authModules);
      for (let chunk = 0; chunk < 5; chunk++) {
        await t.mutation(internal.migrations.testing.support.seedAuthOrgs, {
          orgs: Array.from({ length: 50 }, (_, i) => {
            const n = chunk * 50 + i + 1;
            return {
              slug: `org${String(n).padStart(3, '0')}`,
              name: `Org ${n}`,
            };
          }),
        });
      }

      // Attempt 1 crashes on the 120th distinct org (inside the first
      // 200-org page).
      await expect(
        t.action(internal.migrations.framework.entrypoints.applyUp, {
          only: [h.ids.FLEET_ID],
        }),
      ).rejects.toThrow(/injected fleet crash/);

      const failed = await ledgerRow(t, h.ids.FLEET_ID);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toContain('injected fleet crash');
      // The 119 orgs completed before the crash are recorded. The stored
      // resume cursor is the CRASHED page's start (null — the first page):
      // resume must re-fetch that page and skip via processedOrgs, never
      // jump past the crashed org's page remainder.
      expect(failed?.processedOrgs).toHaveLength(119);
      expect(failed?.orgCursor ?? null).toBeNull();

      // Attempt 2 resumes and completes.
      const retry = await t.action(
        internal.migrations.framework.entrypoints.applyUp,
        { only: [h.ids.FLEET_ID] },
      );
      expect(retry.completed).toEqual([h.ids.FLEET_ID]);
      expect((await ledgerRow(t, h.ids.FLEET_ID))?.status).toBe('applied');

      // EVERY one of the 250 orgs was migrated. Completed orgs were skipped
      // on resume (exactly one call each); only the crashed org ran twice —
      // its first call threw before doing work, and handler idempotency
      // makes the replay safe.
      expect(h.state.fleetCalls.size).toBe(250);
      const reruns = [...h.state.fleetCalls.values()].filter((c) => c > 1);
      expect(reruns).toEqual([2]);
      const applied = await ledgerRow(t, h.ids.FLEET_ID);
      expect(applied?.processedOrgs).toHaveLength(250);
    },
  );

  it('fails when the org pagination cursor does not advance', async () => {
    const t = newWorld({
      ...modules,
      [ORG_SOURCE_KEY]: async () => stuckOrgSource,
    });

    await expect(
      t.action(internal.migrations.framework.entrypoints.applyUp, {
        only: [h.ids.STUCK_ID],
      }),
    ).rejects.toThrow(/org pagination cursor did not advance/);

    // The single org on the repeating page ran exactly once (the processed
    // set absorbed the repeats before the cursor check tripped).
    expect(h.state.stuckRuns).toBe(1);
    const row = await ledgerRow(t, h.ids.STUCK_ID);
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('cursor did not advance');
  });

  it('fails when org pagination exceeds maxOrgPages', async () => {
    setLimitsForTest({ maxOrgPages: 2 });
    const t = newWorld({
      ...modules,
      [ORG_SOURCE_KEY]: async () => advancingOrgSource,
    });

    await expect(
      t.action(internal.migrations.framework.entrypoints.applyUp, {
        only: [h.ids.PAGES_ID],
      }),
    ).rejects.toThrow(/org pagination did not terminate/);
    expect(advancingCalls).toBe(2);
  });
});

describe('entrypoints formerIds (re-homed migrations)', () => {
  async function insertFormerRow(
    t: ReturnType<typeof newWorld>,
    status: 'applied' | 'running',
    direction: 'up' | 'down' = 'up',
    cursor: string | null = null,
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert('migrationLedger', {
        migrationId: h.ids.FORMER_ID,
        semver: '9.9.6',
        numericId: 1,
        orderKey: buildOrderKey('9.9.6', 1),
        direction,
        status,
        cursor,
        orgCursor: null,
        processedOrgs: [],
      });
    });
  }

  it('adopts an applied ledger row under a former id instead of re-running', async () => {
    const t = newWorld();
    await insertFormerRow(t, 'applied');

    const result = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [h.ids.RENAMED_ID], allowDestructive: true },
    );
    expect(result.completed).toEqual([]);

    const adopted = await ledgerRow(t, h.ids.RENAMED_ID);
    expect(adopted?.status).toBe('applied');
    expect(adopted?.semver).toBe('9.9.9');
    expect(adopted?.orderKey).toBe(buildOrderKey('9.9.9', 6));
    expect(await ledgerRow(t, h.ids.FORMER_ID)).toBeNull();
  });

  it('status and planUp fold former-id rows read-only (no adoption write)', async () => {
    const t = newWorld();
    await insertFormerRow(t, 'applied');

    const status = await t.query(
      internal.migrations.framework.entrypoints.status,
      {},
    );
    expect(status.applied.map((m) => m.id)).toContain(h.ids.RENAMED_ID);

    const plan = await t.query(
      internal.migrations.framework.entrypoints.planUp,
      {},
    );
    expect(plan.map((m) => m.id)).not.toContain(h.ids.RENAMED_ID);

    // Queries cannot write: the row still sits under the former id.
    expect(await ledgerRow(t, h.ids.FORMER_ID)).not.toBeNull();
    expect(await ledgerRow(t, h.ids.RENAMED_ID)).toBeNull();
  });

  it('down restores table-rows snapshots captured under the former id', async () => {
    const t = newWorld();
    await insertFormerRow(t, 'applied');
    await t.run(async (ctx) => {
      await ctx.db.insert('migrationSnapshots', {
        migrationId: h.ids.FORMER_ID,
        scope: 'table-rows:items:row1',
        payload: { n: 777 },
        createdAt: 1,
      });
    });

    const result = await t.action(
      internal.migrations.framework.entrypoints.applyDown,
      { to: '9.9.6', only: [h.ids.RENAMED_ID] },
    );
    expect(result.completed).toEqual([h.ids.RENAMED_ID]);

    const items = await t.run(async (ctx) => ctx.db.query('items').collect());
    expect(items.map((i) => i.n)).toContain(777);
    const snaps = await t.run(async (ctx) =>
      ctx.db.query('migrationSnapshots').collect(),
    );
    expect(snaps).toEqual([]);
    expect((await ledgerRow(t, h.ids.RENAMED_ID))?.status).toBe('rolledBack');
  });

  it('adoption is idempotent and resets a down-running restore cursor', async () => {
    const t = newWorld();
    await insertFormerRow(t, 'running', 'down', 'mid-stream-cursor');

    const aliases = [
      {
        migrationId: h.ids.RENAMED_ID,
        semver: '9.9.9',
        numericId: 6,
        orderKey: buildOrderKey('9.9.9', 6),
        formerIds: [h.ids.FORMER_ID],
      },
    ];
    const first = await t.mutation(
      internal.migrations.framework.ledger.reconcileAliases,
      { aliases },
    );
    expect(first).toBe(1);

    const adopted = await ledgerRow(t, h.ids.RENAMED_ID);
    // The old cursor paginated the FORMER id's snapshot stream — useless to
    // the new id's restore query, so adoption resets it (restores re-drain).
    expect(adopted?.cursor).toBeNull();
    expect(adopted?.status).toBe('running');

    const second = await t.mutation(
      internal.migrations.framework.ledger.reconcileAliases,
      { aliases },
    );
    expect(second).toBe(0);
  });
});
