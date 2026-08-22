/**
 * One-call construction of a fully seeded baseline world: convex-test over
 * the union `worldSchema` with the REAL betterAuth component registered, the
 * three corpus orgs created through the shipped support mutation, all
 * baseline DB rows inserted, and the fixture config trees copied into the
 * caller's temp `TALE_CONFIG_DIR` root. Shared by the corpus smoke test and
 * the chain harness; the container e2e reuses the corpus through its own
 * export script.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

import { convexTest, type TestConvex } from 'convex-test';
import type { GenericSchema, SchemaDefinition } from 'convex/server';

import { internal } from '../../../_generated/api';
import betterAuthSchema from '../../../betterAuth/schema';
import { worldSchema } from '../world_schema.testkit';
import { WORLD_ORGS } from './manifest.testkit';
import { seedWorldDb, type SeedWorldOrgs } from './seed_db.testkit';
import { seedWorldFs } from './seed_fs.testkit';

// oxlint-disable-next-line typescript/no-explicit-any -- convex-test is schema-generic; world tables span legacy shapes
export type WorldTestConvex = TestConvex<any>;

export interface SeededWorld {
  readonly t: WorldTestConvex;
  readonly orgs: SeedWorldOrgs;
}

/** Every table of the union world schema, for whole-world digests. */
export function worldTables(): string[] {
  const exportFn = Reflect.get(worldSchema, 'export');
  if (typeof exportFn !== 'function') {
    throw new Error('worldSchema has no export() — convex API changed?');
  }
  const parsed = JSON.parse(String(exportFn.call(worldSchema))) as {
    tables?: Array<{ tableName: string }>;
  };
  return (parsed.tables ?? []).map((t) => t.tableName);
}

/** Row collector over a world, for `digestDb`/`digestWorld`. */
export function collectVia(t: WorldTestConvex) {
  return (table: string): Promise<Array<Record<string, unknown>>> =>
    t.run((ctx) =>
      // oxlint-disable-next-line typescript/no-explicit-any -- legacy/undeclared tables are read untyped
      (ctx.db.query(table as any) as any).collect(),
    );
}

/**
 * Build and seed the world. The caller owns `configRoot` (a mkdtemp dir) and
 * must have stubbed `TALE_CONFIG_DIR` to it (plus `ENCRYPTION_SECRET_HEX` to
 * `WORLD_ENCRYPTION_SECRET_HEX`) BEFORE migrations run. `schema` defaults to
 * the union `worldSchema`; the production-schema seed guard passes the live
 * `convex/schema.ts` instead to reproduce the real backend's validation
 * posture (declared tables validated, legacy tables passed through).
 */
export async function buildSeededWorld(
  configRoot: string,
  modules: Record<string, () => Promise<unknown>>,
  authModules: Record<string, () => Promise<unknown>>,
  schema: SchemaDefinition<GenericSchema, boolean> = worldSchema,
): Promise<SeededWorld> {
  const t = convexTest(schema, modules) as WorldTestConvex;
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  const seeded: Array<{ id: string; slug: string }> = await t.mutation(
    internal.migrations.testing.support.seedAuthOrgs,
    {
      orgs: Object.values(WORLD_ORGS).map((o) => ({
        slug: o.slug,
        name: o.name,
      })),
    },
  );
  const bySlug = new Map(seeded.map((o) => [o.slug, o]));
  const need = (slug: string): { id: string; slug: string } => {
    const org = bySlug.get(slug);
    if (!org) throw new Error(`seedAuthOrgs did not return org "${slug}"`);
    return org;
  };
  const orgs: SeedWorldOrgs = {
    alpha: need(WORLD_ORGS.alpha.slug),
    beta: need(WORLD_ORGS.beta.slug),
    empty: need(WORLD_ORGS.empty.slug),
  };
  await t.run(async (ctx) => {
    await seedWorldDb(ctx, orgs, {
      storeBlob: (content) => ctx.storage.store(new Blob([content])),
    });
  });
  await seedWorldFs(configRoot);
  return { t, orgs };
}
