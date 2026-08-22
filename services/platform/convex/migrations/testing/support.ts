/**
 * Shipped support functions for migration testing — the ONLY sanctioned way
 * test worlds and the container e2e write Better Auth component tables
 * (organizations live in the component; `ctx.db` cannot reach them, and the
 * adapter is only callable from app code). Internal functions: reachable with
 * the deployment admin key only, never from clients. Precedent:
 * `provisioning/seed_dev_user.ts`.
 *
 * Everything test-ONLY (the world corpus, digests, the harness) lives beside
 * this module in two-dot `.testkit.ts` files the Convex bundler skips; this
 * file stays push-safe by construction.
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { WORLD_ORGS } from './world/manifest.testkit';
import {
  WORLD_BLOB_CONTENTS,
  seedWorldDb,
  type SeedWorldOrgs,
} from './world/seed_db.testkit';

/**
 * Create Better Auth organizations for a test world / e2e fixture. Idempotent
 * on slug: an existing org is returned, not duplicated.
 */
interface OrgCtx {
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runQuery: (...args: any[]) => Promise<any>;
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runMutation: (...args: any[]) => Promise<any>;
}

/** Create one Better Auth organization; idempotent on slug. */
async function ensureOrg(
  ctx: OrgCtx,
  org: { slug: string; name: string },
): Promise<{ id: string; slug: string }> {
  const existing: unknown = await ctx.runQuery(
    components.betterAuth.adapter.findOne,
    {
      model: 'organization',
      where: [{ field: 'slug', value: org.slug }],
    },
  );
  const existingId = isRecord(existing)
    ? (getString(existing, '_id') ?? '')
    : '';
  if (existingId) return { id: existingId, slug: org.slug };

  const data = {
    name: org.name,
    slug: org.slug,
    createdAt: Date.now(),
  };
  const created: unknown = await ctx.runMutation(
    components.betterAuth.adapter.create,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter's data validator is model-generic; the organization shape is checked by the component schema
    { input: { model: 'organization', data: data as never } },
  );
  const id = isRecord(created) ? (getString(created, '_id') ?? '') : '';
  if (!id) {
    throw new Error(
      `ensureOrg: adapter.create returned no id for "${org.slug}"`,
    );
  }
  return { id, slug: org.slug };
}

export const seedAuthOrgs = internalMutation({
  args: {
    orgs: v.array(v.object({ slug: v.string(), name: v.string() })),
  },
  returns: v.array(v.object({ id: v.string(), slug: v.string() })),
  handler: async (ctx, args) => {
    const out: Array<{ id: string; slug: string }> = [];
    for (const org of args.orgs) {
      out.push(await ensureOrg(ctx, org));
    }
    return out;
  },
});

const worldOrgValidator = v.object({ id: v.string(), slug: v.string() });

/**
 * Seed the ENTIRE baseline world corpus into a REAL deployment — the
 * container e2e's tier-1 old-state injection. An action because blobs need
 * `ctx.storage.store` (mutation ctxs cannot store); the rows themselves land
 * transactionally in {@link seedWorldRows}.
 */
export const seedWorld = internalAction({
  args: {},
  returns: v.object({
    alpha: worldOrgValidator,
    beta: worldOrgValidator,
    empty: worldOrgValidator,
  }),
  handler: async (ctx): Promise<SeedWorldOrgs> => {
    const storageIds: string[] = [];
    for (const content of WORLD_BLOB_CONTENTS) {
      storageIds.push(await ctx.storage.store(new Blob([content])));
    }
    return await ctx.runMutation(
      internal.migrations.testing.support.seedWorldRows,
      { storageIds },
    );
  },
});

/**
 * The transactional half of {@link seedWorld}: creates the three corpus orgs
 * (idempotent on slug) and inserts every baseline row. `storageIds` must be
 * the pre-stored {@link WORLD_BLOB_CONTENTS} ids IN ORDER — consumed as a
 * queue that throws on any count mismatch, so the list cannot drift from the
 * corpus's storeBlob call sites.
 */
export const seedWorldRows = internalMutation({
  args: { storageIds: v.array(v.string()) },
  returns: v.object({
    alpha: worldOrgValidator,
    beta: worldOrgValidator,
    empty: worldOrgValidator,
  }),
  handler: async (ctx, args) => {
    const seeded = new Map<string, { id: string; slug: string }>();
    for (const org of Object.values(WORLD_ORGS)) {
      seeded.set(org.slug, await ensureOrg(ctx, org));
    }
    const need = (slug: string): { id: string; slug: string } => {
      const org = seeded.get(slug);
      if (!org) throw new Error(`seedWorldRows: org "${slug}" missing`);
      return org;
    };
    const orgs: SeedWorldOrgs = {
      alpha: need(WORLD_ORGS.alpha.slug),
      beta: need(WORLD_ORGS.beta.slug),
      empty: need(WORLD_ORGS.empty.slug),
    };

    const queue = [...args.storageIds];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeder's structural ctx inserts into legacy tables the generated MutationCtx types can't name
    await seedWorldDb(ctx, orgs, {
      storeBlob: (content: string) => {
        const id = queue.shift();
        if (!id) {
          throw new Error(
            `seedWorldRows: ran out of pre-stored blobs at "${content}" — WORLD_BLOB_CONTENTS is out of sync with the corpus`,
          );
        }
        return Promise.resolve(id);
      },
    });
    if (queue.length > 0) {
      throw new Error(
        `seedWorldRows: ${queue.length} unused pre-stored blob(s) — WORLD_BLOB_CONTENTS is out of sync with the corpus`,
      );
    }
    return orgs;
  },
});

/**
 * Dump every row of the named app tables (system fields included) so the
 * container e2e can deep-compare data before/after a migration chain without
 * shelling into the database. Tables absent from the schema are read
 * untyped — legacy tables keep their rows after a schema drop.
 */
export const dumpTables = internalQuery({
  args: { tables: v.array(v.string()) },
  returns: v.record(v.string(), v.array(v.any())),
  handler: async (ctx, args) => {
    const out: Record<string, unknown[]> = {};
    for (const table of args.tables) {
      // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- legacy/undeclared tables are read untyped
      out[table] = await (ctx.db.query(table as any) as any).collect();
    }
    return out;
  },
});
