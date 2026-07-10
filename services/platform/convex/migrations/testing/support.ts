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
import { components } from '../../_generated/api';
import { internalMutation, internalQuery } from '../../_generated/server';

/**
 * Create Better Auth organizations for a test world / e2e fixture. Idempotent
 * on slug: an existing org is returned, not duplicated.
 */
export const seedAuthOrgs = internalMutation({
  args: {
    orgs: v.array(v.object({ slug: v.string(), name: v.string() })),
  },
  returns: v.array(v.object({ id: v.string(), slug: v.string() })),
  handler: async (ctx, args) => {
    const out: Array<{ id: string; slug: string }> = [];
    for (const org of args.orgs) {
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
      if (existingId) {
        out.push({ id: existingId, slug: org.slug });
        continue;
      }
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
          `seedAuthOrgs: adapter.create returned no id for "${org.slug}"`,
        );
      }
      out.push({ id, slug: org.slug });
    }
    return out;
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
