import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import { internal } from '../../_generated/api';
import { migrationLedgerTable, migrationSnapshotsTable } from './schema';
import { buildOrderKey } from './semver';
import { buildModules } from './test_helpers';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/framework',
);

const fixtureSchema = defineSchema({
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
});

const MIGRATION_A = '9.9.9/01_alpha';
const MIGRATION_B = '9.9.9/02_beta';

function newWorld() {
  return convexTest(fixtureSchema, modules);
}

function beginArgs(migrationId: string, direction: 'up' | 'down') {
  const [semver, rest] = migrationId.split('/');
  const numericId = Number.parseInt(rest.slice(0, 2), 10);
  return {
    migrationId,
    semver,
    numericId,
    orderKey: buildOrderKey(semver, numericId),
    direction,
  };
}

async function rowFor(t: ReturnType<typeof newWorld>, migrationId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('migrationLedger')
      .withIndex('by_migrationId', (q) => q.eq('migrationId', migrationId))
      .unique();
  });
}

describe('ledger.beginRun', () => {
  it('creates a running row with empty resume state and returns it', async () => {
    const t = newWorld();
    const resume = await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    expect(resume).toEqual({
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
      snapshotRef: null,
    });

    const row = await rowFor(t, MIGRATION_A);
    expect(row).toMatchObject({
      migrationId: MIGRATION_A,
      semver: '9.9.9',
      numericId: 1,
      direction: 'up',
      status: 'running',
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
    });
    expect(row?.snapshotRef).toBeUndefined();
    expect(row?.error).toBeUndefined();
  });

  it('preserves and returns resume state over a failed run in the same direction', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(internal.migrations.framework.ledger.setCursor, {
      migrationId: MIGRATION_A,
      cursor: 'cursor-1',
    });
    await t.mutation(internal.migrations.framework.ledger.recordOrgProgress, {
      migrationId: MIGRATION_A,
      orgId: 'org_1',
      orgCursor: 'org-cursor-1',
    });
    await t.mutation(internal.migrations.framework.ledger.setSnapshotRef, {
      migrationId: MIGRATION_A,
      snapshotRef: 'ref-1',
    });
    await t.mutation(internal.migrations.framework.ledger.failRun, {
      migrationId: MIGRATION_A,
      error: 'boom',
    });

    const resume = await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    expect(resume).toEqual({
      cursor: 'cursor-1',
      orgCursor: 'org-cursor-1',
      processedOrgs: ['org_1'],
      snapshotRef: 'ref-1',
    });

    const row = await rowFor(t, MIGRATION_A);
    expect(row).toMatchObject({
      status: 'running',
      cursor: 'cursor-1',
      orgCursor: 'org-cursor-1',
      processedOrgs: ['org_1'],
      snapshotRef: 'ref-1',
    });
    // The retry cleared the failure message.
    expect(row?.error).toBeUndefined();
  });

  it('preserves resume state over a still-running row in the same direction', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(internal.migrations.framework.ledger.setCursor, {
      migrationId: MIGRATION_A,
      cursor: 'cursor-2',
    });

    const resume = await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    expect(resume).toEqual({
      cursor: 'cursor-2',
      orgCursor: null,
      processedOrgs: [],
      snapshotRef: null,
    });
  });

  it('clears resume state when the direction flips', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(internal.migrations.framework.ledger.setCursor, {
      migrationId: MIGRATION_A,
      cursor: 'cursor-1',
    });
    await t.mutation(internal.migrations.framework.ledger.recordOrgProgress, {
      migrationId: MIGRATION_A,
      orgId: 'org_1',
      orgCursor: 'org-cursor-1',
    });
    await t.mutation(internal.migrations.framework.ledger.setSnapshotRef, {
      migrationId: MIGRATION_A,
      snapshotRef: 'ref-1',
    });
    await t.mutation(internal.migrations.framework.ledger.completeRun, {
      migrationId: MIGRATION_A,
      direction: 'up',
      durationMs: 10,
    });

    // applied → beginRun(down) resets every resume field.
    const downResume = await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'down'),
    );
    expect(downResume).toEqual({
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
      snapshotRef: null,
    });
    let row = await rowFor(t, MIGRATION_A);
    expect(row).toMatchObject({
      direction: 'down',
      status: 'running',
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
    });
    expect(row?.snapshotRef).toBeUndefined();

    // rolledBack → beginRun(up) resets again.
    await t.mutation(internal.migrations.framework.ledger.setCursor, {
      migrationId: MIGRATION_A,
      cursor: 'down-cursor',
    });
    await t.mutation(internal.migrations.framework.ledger.completeRun, {
      migrationId: MIGRATION_A,
      direction: 'down',
      durationMs: 20,
    });
    const upResume = await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    expect(upResume).toEqual({
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
      snapshotRef: null,
    });
    row = await rowFor(t, MIGRATION_A);
    expect(row).toMatchObject({ direction: 'up', cursor: null });
  });
});

describe('ledger.completeRun / failRun', () => {
  it('completeRun up stamps applied with appliedAt and durationMs and clears the error', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(internal.migrations.framework.ledger.failRun, {
      migrationId: MIGRATION_A,
      error: 'transient',
    });
    const before = Date.now();
    await t.mutation(internal.migrations.framework.ledger.completeRun, {
      migrationId: MIGRATION_A,
      direction: 'up',
      durationMs: 1234,
    });

    const row = await rowFor(t, MIGRATION_A);
    expect(row?.status).toBe('applied');
    expect(row?.durationMs).toBe(1234);
    expect(row?.appliedAt).toBeGreaterThanOrEqual(before);
    expect(row?.error).toBeUndefined();
  });

  it('completeRun down stamps rolledBack and unsets appliedAt', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(internal.migrations.framework.ledger.completeRun, {
      migrationId: MIGRATION_A,
      direction: 'up',
      durationMs: 10,
    });
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'down'),
    );
    await t.mutation(internal.migrations.framework.ledger.completeRun, {
      migrationId: MIGRATION_A,
      direction: 'down',
      durationMs: 77,
    });

    const row = await rowFor(t, MIGRATION_A);
    expect(row?.status).toBe('rolledBack');
    expect(row?.durationMs).toBe(77);
    expect(row?.appliedAt).toBeUndefined();
    expect(row?.error).toBeUndefined();
  });

  it('failRun stamps failed and stores the error message', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(internal.migrations.framework.ledger.failRun, {
      migrationId: MIGRATION_A,
      error: 'kaput: table exploded',
    });

    const row = await rowFor(t, MIGRATION_A);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('kaput: table exploded');
  });
});

describe('ledger.setCursor / setSnapshotRef', () => {
  it('update the row for a known migration', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );

    await t.mutation(internal.migrations.framework.ledger.setCursor, {
      migrationId: MIGRATION_A,
      cursor: 'cursor-x',
    });
    expect((await rowFor(t, MIGRATION_A))?.cursor).toBe('cursor-x');

    await t.mutation(internal.migrations.framework.ledger.setCursor, {
      migrationId: MIGRATION_A,
      cursor: null,
    });
    expect((await rowFor(t, MIGRATION_A))?.cursor).toBeNull();

    await t.mutation(internal.migrations.framework.ledger.setSnapshotRef, {
      migrationId: MIGRATION_A,
      snapshotRef: 'snap-ref',
    });
    expect((await rowFor(t, MIGRATION_A))?.snapshotRef).toBe('snap-ref');
  });

  it('are no-ops on a missing row (pinned: no throw, no row created)', async () => {
    const t = newWorld();
    await expect(
      t.mutation(internal.migrations.framework.ledger.setCursor, {
        migrationId: 'ghost/00_missing',
        cursor: 'cursor-x',
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(internal.migrations.framework.ledger.setSnapshotRef, {
        migrationId: 'ghost/00_missing',
        snapshotRef: 'snap-ref',
      }),
    ).resolves.toBeNull();

    const rows = await t.query(
      internal.migrations.framework.ledger.getLedgerState,
      {},
    );
    expect(rows).toEqual([]);
  });
});

describe('ledger.recordOrgProgress', () => {
  it('appends org ids without duplicates and advances the org cursor', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );

    await t.mutation(internal.migrations.framework.ledger.recordOrgProgress, {
      migrationId: MIGRATION_A,
      orgId: 'org_1',
      orgCursor: 'c1',
    });
    await t.mutation(internal.migrations.framework.ledger.recordOrgProgress, {
      migrationId: MIGRATION_A,
      orgId: 'org_2',
      orgCursor: 'c2',
    });
    // Re-recording an already-processed org must not duplicate it, but the
    // cursor still advances.
    await t.mutation(internal.migrations.framework.ledger.recordOrgProgress, {
      migrationId: MIGRATION_A,
      orgId: 'org_1',
      orgCursor: 'c3',
    });

    const row = await rowFor(t, MIGRATION_A);
    expect(row?.processedOrgs).toEqual(['org_1', 'org_2']);
    expect(row?.orgCursor).toBe('c3');
  });
});

describe('ledger.getLedgerState', () => {
  it('returns every ledger row', async () => {
    const t = newWorld();
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_A, 'up'),
    );
    await t.mutation(
      internal.migrations.framework.ledger.beginRun,
      beginArgs(MIGRATION_B, 'up'),
    );

    const rows = await t.query(
      internal.migrations.framework.ledger.getLedgerState,
      {},
    );
    expect(rows.map((r) => r.migrationId).sort()).toEqual([
      MIGRATION_A,
      MIGRATION_B,
    ]);
  });
});
