import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_4_0/24_slack_team_routes_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migrations never run through the runner — the round-trip test
// calls the handlers directly. This release INTRODUCES the table, so the
// fixture carries only the post-change shape: the "pre-change" world is the
// table not existing, which is what `down` restores by emptying it.
const fixtureSchema = defineSchema({
  slackTeamRoutes: defineTable({
    organizationId: v.string(),
    teamId: v.string(),
    credentialId: v.string(),
    createdAt: v.number(),
  }).index('by_team', ['teamId']),
});

describe('0.4.0/24_slack_team_routes_table (reference)', () => {
  it('up leaves rows untouched; down empties the table (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('slackTeamRoutes', {
        organizationId: 'org_1',
        teamId: 'T0ROUTE001',
        credentialId: 'credential_1',
        createdAt: 1_700_000_000_000,
      });
      await ctx.db.insert('slackTeamRoutes', {
        organizationId: 'org_2',
        teamId: 'T0ROUTE002',
        credentialId: 'credential_2',
        createdAt: 1_700_000_001_000,
      });
    });

    // up: a no-op — an installed route survives the forward pass unchanged.
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of await ctx.db.query('slackTeamRoutes').collect()) {
          await migration.up(ctx, doc as never);
        }
      }
      const rows = await ctx.db.query('slackTeamRoutes').collect();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.teamId).sort()).toEqual([
        'T0ROUTE001',
        'T0ROUTE002',
      ]);
    });

    // down: empties the table so a pre-change schema validates. The second
    // pass proves the guard — re-running must not throw on an already-deleted
    // row.
    await t.run(async (ctx) => {
      const seeded = await ctx.db.query('slackTeamRoutes').collect();
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of seeded) {
          await migration.down(ctx, doc as never);
        }
      }
      expect(await ctx.db.query('slackTeamRoutes').collect()).toHaveLength(0);
    });
  });
});
