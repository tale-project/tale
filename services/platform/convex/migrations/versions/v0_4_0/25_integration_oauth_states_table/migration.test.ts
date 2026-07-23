import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_4_0/25_integration_oauth_states_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migrations never run through the runner — the round-trip test
// calls the handlers directly. This release INTRODUCES the table, so the
// fixture carries only the post-change shape: the "pre-change" world is the
// table not existing, which is what `down` restores by emptying it.
const fixtureSchema = defineSchema({
  integrationOauthStates: defineTable({
    stateHash: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    connectorSlug: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index('by_state_hash', ['stateHash']),
});

describe('0.4.0/25_integration_oauth_states_table (reference)', () => {
  it('up leaves rows untouched; down empties the table (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('integrationOauthStates', {
        stateHash: 'a'.repeat(64),
        organizationId: 'org_1',
        userId: 'user_1',
        connectorSlug: 'slack',
        codeVerifier: 'verifier-1',
        redirectUri: 'https://tale.example/api/integrations/oauth2/callback',
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_600_000,
      });
    });

    // up: a no-op — an in-flight authorization survives the forward pass.
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of await ctx.db
          .query('integrationOauthStates')
          .collect()) {
          await migration.up(ctx, doc as never);
        }
      }
      const rows = await ctx.db.query('integrationOauthStates').collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].connectorSlug).toBe('slack');
    });

    // down: empties the table so a pre-change schema validates. The second
    // pass proves the guard — re-running must not throw on an already-deleted
    // row.
    await t.run(async (ctx) => {
      const seeded = await ctx.db.query('integrationOauthStates').collect();
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of seeded) {
          await migration.down(ctx, doc as never);
        }
      }
      expect(
        await ctx.db.query('integrationOauthStates').collect(),
      ).toHaveLength(0);
    });
  });
});
