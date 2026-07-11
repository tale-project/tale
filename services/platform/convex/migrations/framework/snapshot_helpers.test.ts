import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { migrationLedgerTable, migrationSnapshotsTable } from './schema';
import {
  snapshotBetterAuthRow,
  snapshotRow,
  stripSystemFields,
} from './snapshot_helpers';
import { buildModules } from './test_helpers';
import type { MigrationDoc } from './types';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/framework',
);

const fixtureSchema = defineSchema({
  widgets: defineTable({ name: v.string() }),
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
});

const MIGRATION_ID = '9.9.9/01_snapshot_probe';

describe('stripSystemFields', () => {
  it('removes only _id and _creationTime and does not mutate the input', () => {
    const doc = {
      _id: 'row_1',
      _creationTime: 123,
      name: 'w1',
      _meta: 'kept-despite-underscore',
      nested: { _id: 'inner-untouched' },
    };
    const stripped = stripSystemFields(doc);
    expect(stripped).toEqual({
      name: 'w1',
      _meta: 'kept-despite-underscore',
      nested: { _id: 'inner-untouched' },
    });
    // Non-mutating: the original still carries its system fields.
    expect(doc._id).toBe('row_1');
    expect(doc._creationTime).toBe(123);
  });
});

describe('snapshotRow', () => {
  it('inserts a migrationSnapshots row with the scope, stripped payload, and createdAt', async () => {
    const t = convexTest(fixtureSchema, modules);
    const before = Date.now();
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('widgets', { name: 'w1' });
      const doc = (await ctx.db.get(id)) as unknown as MigrationDoc;
      await snapshotRow(
        ctx as never,
        MIGRATION_ID,
        `widgets:${String(id)}`,
        doc,
      );

      const snaps = await ctx.db.query('migrationSnapshots').collect();
      expect(snaps).toHaveLength(1);
      expect(snaps[0].migrationId).toBe(MIGRATION_ID);
      expect(snaps[0].scope).toBe(`widgets:${String(id)}`);
      // System fields stripped so the payload can be re-inserted fresh.
      expect(snaps[0].payload).toEqual({ name: 'w1' });
      expect(snaps[0].createdAt).toBeGreaterThanOrEqual(before);
      expect(snaps[0].createdAt).toBeLessThanOrEqual(Date.now());
    });
  });
});

describe('snapshotBetterAuthRow', () => {
  it('formats the component scope from the string _id and strips it from the payload', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await snapshotBetterAuthRow(ctx as never, MIGRATION_ID, 'user', {
        _id: 'user_legacy_1',
        email: 'a@b.c',
        name: 'A',
      });

      const snaps = await ctx.db.query('migrationSnapshots').collect();
      expect(snaps).toHaveLength(1);
      expect(snaps[0].scope).toBe('component:betterAuth:user:user_legacy_1');
      // PINNED: the row id survives only in the scope. snapshotBetterAuthRow
      // spreads the doc with its string _id, but snapshotRow strips top-level
      // system fields, so the stored payload carries NO _id (restore assigns a
      // fresh component id and re-strips defensively).
      expect(snaps[0].payload).toEqual({ email: 'a@b.c', name: 'A' });
    });
  });

  it('falls back to an "unknown" scope id when the doc has no string _id', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await snapshotBetterAuthRow(ctx as never, MIGRATION_ID, 'member', {
        role: 'owner',
      });

      const snaps = await ctx.db.query('migrationSnapshots').collect();
      expect(snaps).toHaveLength(1);
      expect(snaps[0].scope).toBe('component:betterAuth:member:unknown');
      expect(snaps[0].payload).toEqual({ role: 'owner' });
    });
  });
});
