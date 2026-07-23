/**
 * The declarative per-migration test contract: a migration's
 * `migration.test.ts` provides DATA and migration-specific ASSERTIONS; this
 * harness owns the RITUAL every migration must survive, executed through the
 * REAL production path (entrypoints → planner → ledger → batch runner /
 * org fleet loop → node_runner) with the real betterAuth component — never a
 * stub ctx:
 *
 *   1. meta is registered and well-formed (id pins the ledger key)
 *   2. `up` applies through the real runner; `expectUp` asserts the truth;
 *      ledger lands on `applied` with drained cursors
 *   3. destructive migrations are refused without `allowDestructive`, with
 *      the world digest untouched
 *   4. handler idempotency OVER MIGRATED STATE: re-invoking the handler
 *      directly leaves the world digest unchanged (the resume-safety
 *      contract a planner no-op "second applyUp" does not prove)
 *   5. `down` restores the seeded world byte-for-byte (content-addressed
 *      digest, central + per-spec exemptions); ledger lands on `rolledBack`
 *   6. snapshot hygiene: table-rows snapshots exist after up and are fully
 *      consumed by down; fs-tree sidecars appear under the config root
 *
 * Node-kind test files must carry the vitest node-environment docblock
 * (asserted; knip misreads the literal directive in comments as a dep).
 * Two-dot basename: test-only module, excluded from the Convex bundle.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convexTest, type TestConvex } from 'convex-test';
import type { SchemaDefinition } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import betterAuthSchema from '../../betterAuth/schema';
import { requireMeta } from '../framework/registry.gen';
import type { MigrationMeta } from '../framework/types';
import {
  digestWorld,
  diffWorldDigests,
  type WorldDigest,
} from './digest.testkit';
import { withRetiredRuntimeStubs } from './retired_runtime.testkit';
import { worldSchema } from './world_schema.testkit';

/**
 * The corpus's canonical secret-encryption key (frozen with the JWE fixtures
 * in `world/seed_db.testkit.ts`), stubbed into every world so seeds and
 * handlers agree. Re-exported for spec authors.
 */
export { WORLD_ENCRYPTION_SECRET_HEX } from './world/seed_db.testkit';
import { WORLD_ENCRYPTION_SECRET_HEX } from './world/seed_db.testkit';

// oxlint-disable-next-line typescript/no-explicit-any -- convex-test is schema-generic; the harness runs many schemas
type AnyTestConvex = TestConvex<any>;

/** The ctx handed to `seed` — convex-test's run ctx, structurally. */
export interface WorldSeedCtx {
  // oxlint-disable-next-line typescript/no-explicit-any -- world tables span legacy shapes the generated types can't describe
  db: any;
  storage: { store: (blob: Blob) => Promise<string> };
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runQuery: (...args: any[]) => Promise<any>;
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runMutation: (...args: any[]) => Promise<any>;
}

export interface WorldOrg {
  readonly id: string;
  readonly slug: string;
}

/** Everything a spec callback can reach. */
export interface WorldHandle {
  readonly t: AnyTestConvex;
  readonly meta: MigrationMeta;
  readonly configRoot: string;
  readonly orgs: readonly WorldOrg[];
  run<T>(fn: (ctx: WorldSeedCtx) => Promise<T>): Promise<T>;
  applyUpOnly(): Promise<void>;
  applyDownOnly(): Promise<void>;
  digest(): Promise<WorldDigest>;
  ledgerRow(): Promise<Record<string, unknown> | null>;
}

export interface MigrationTestSpec {
  /** The migration's stable id — pins the ledger key against folder renames. */
  readonly id: string;
  /** Module map: buildModules over the test file's import.meta.glob. */
  readonly modules: Record<string, () => Promise<unknown>>;
  /** Override only with a documented reason; default worldSchema. */
  // oxlint-disable-next-line typescript/no-explicit-any -- schema-generic by design
  readonly schema?: SchemaDefinition<any, boolean>;
  /** Orgs registered in the auth component. Default one org `org1`. */
  readonly orgs?: ReadonlyArray<{ slug: string; name?: string }>;
  /** Seed the DB state the migration's `up` expects (baseline shape). */
  seed?(ctx: WorldSeedCtx, orgs: readonly WorldOrg[]): Promise<void>;
  /** Seed org-config files under the temp config root. Called once. */
  seedFs?(root: string, orgs: readonly WorldOrg[]): Promise<void>;
  /** Post-up assertions — the migration-specific truth. */
  expectUp(world: WorldHandle): Promise<void>;
  /** Optional post-down assertions beyond the automatic digest equality. */
  expectDown?(world: WorldHandle): Promise<void>;
  /**
   * Per-spec digest exemptions (documented in-line at the call site) applied
   * ON TOP of the central equality policy.
   */
  readonly equality?: {
    readonly dropFields?: Readonly<Record<string, readonly string[]>>;
    readonly skipTables?: readonly string[];
  };
  /** Extra scenarios — each gets a FRESH seeded world. */
  readonly cases?: Readonly<
    Record<string, (world: WorldHandle) => Promise<void>>
  >;
  /** Pure unit tests of exported helpers (no world). */
  readonly unit?: Readonly<Record<string, () => void | Promise<void>>>;
}

// oxlint-disable-next-line typescript/no-explicit-any -- schema-generic by design
function tablesOf(schema: SchemaDefinition<any, boolean>): string[] {
  const exportFn = Reflect.get(schema, 'export');
  if (typeof exportFn !== 'function') {
    throw new Error('schema has no export() — convex API changed?');
  }
  const parsed = JSON.parse(String(exportFn.call(schema))) as {
    tables?: Array<{ tableName: string }>;
  };
  return (parsed.tables ?? []).map((t) => t.tableName);
}

function withSpecExemptions(
  tables: string[],
  spec: MigrationTestSpec,
): string[] {
  const skip = new Set(spec.equality?.skipTables ?? []);
  return tables.filter((t) => !skip.has(t));
}

export function defineMigrationTest(spec: MigrationTestSpec): void {
  const meta = requireMeta(spec.id);
  const schema = spec.schema ?? worldSchema;
  const runnable = meta.kind !== 'reference';

  if (meta.kind === 'node' && typeof process?.versions?.node !== 'string') {
    throw new Error(
      `${spec.id}: node migrations need real fs — add \`// @vitest-environment node\` at the top of migration.test.ts`,
    );
  }

  describe(meta.id, () => {
    let configRoot: string;

    beforeEach(async () => {
      configRoot = await mkdtemp(path.join(tmpdir(), 'tale-mig-'));
      vi.stubEnv('TALE_CONFIG_DIR', configRoot);
      vi.stubEnv('ENCRYPTION_SECRET_HEX', WORLD_ENCRYPTION_SECRET_HEX);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await rm(configRoot, { recursive: true, force: true });
    });

    async function makeWorld(): Promise<WorldHandle> {
      const t = convexTest(
        schema,
        withRetiredRuntimeStubs(spec.modules),
      ) as AnyTestConvex;
      t.registerComponent(
        'betterAuth',
        betterAuthSchema,
        import.meta.glob('../../betterAuth/**/*.*s'),
      );
      const orgSpecs = spec.orgs ?? [{ slug: 'org1' }];
      const orgs: WorldOrg[] = await t.mutation(
        internal.migrations.testing.support.seedAuthOrgs,
        {
          orgs: orgSpecs.map((o) => ({
            slug: o.slug,
            name: o.name ?? o.slug,
          })),
        },
      );

      const dropFields = spec.equality?.dropFields ?? {};
      const digestTables = withSpecExemptions(tablesOf(schema), spec);

      const world: WorldHandle = {
        t,
        meta,
        configRoot,
        orgs,
        run: (fn) => t.run(fn as never),
        applyUpOnly: async () => {
          await t.action(internal.migrations.framework.entrypoints.applyUp, {
            only: [meta.id],
            allowDestructive: true,
          });
        },
        applyDownOnly: async () => {
          await t.action(internal.migrations.framework.entrypoints.applyDown, {
            to: '0.0.0',
            only: [meta.id],
          });
        },
        digest: () =>
          digestWorld(
            digestTables,
            (table) =>
              t.run((ctx) =>
                // oxlint-disable-next-line typescript/no-explicit-any -- legacy/undeclared tables are read untyped
                (ctx.db.query(table as any) as any).collect(),
              ),
            configRoot,
            { extraDropFields: dropFields },
          ),
        ledgerRow: () =>
          t.run(async (ctx) => {
            const rows = (await ctx.db
              .query('migrationLedger')
              .collect()) as Array<Record<string, unknown>>;
            return rows.find((r) => r.migrationId === meta.id) ?? null;
          }),
      };

      if (spec.seedFs) await spec.seedFs(configRoot, orgs);
      if (spec.seed) {
        await t.run(async (ctx) => {
          await spec.seed?.(ctx as unknown as WorldSeedCtx, orgs);
        });
      }
      return world;
    }

    it('meta is registered and well-formed', () => {
      expect(meta.reversible).toBe(true);
      if (runnable && meta.destructive) {
        expect(meta.snapshot).not.toBe('none');
      }
    });

    if (runnable) {
      it('up applies through the real runner and down restores the seed', async () => {
        const world = await makeWorld();
        const seedDigest = await world.digest();

        await world.applyUpOnly();
        await spec.expectUp(world);

        const afterUp = await world.ledgerRow();
        expect(afterUp?.status).toBe('applied');
        expect(afterUp?.direction).toBe('up');
        expect(afterUp?.cursor ?? null).toBeNull();

        if (meta.snapshot === 'table-rows') {
          const snaps = await world.run(async (ctx) => {
            const rows = (await ctx.db
              .query('migrationSnapshots')
              .collect()) as Array<Record<string, unknown>>;
            return rows.filter((r) => r.migrationId === meta.id);
          });
          expect(snaps.length).toBeGreaterThan(0);
        }

        await world.applyDownOnly();
        if (spec.expectDown) await spec.expectDown(world);

        const afterDown = await world.ledgerRow();
        expect(afterDown?.status).toBe('rolledBack');

        if (meta.snapshot === 'table-rows') {
          const leftover = await world.run(async (ctx) => {
            const rows = (await ctx.db
              .query('migrationSnapshots')
              .collect()) as Array<Record<string, unknown>>;
            return rows.filter((r) => r.migrationId === meta.id);
          });
          expect(leftover).toEqual([]);
        }

        const downDigest = await world.digest();
        const diff = diffWorldDigests(seedDigest, downDigest);
        expect(
          diff,
          `down(${meta.id}) did not restore the seeded world:\n${diff.join('\n')}`,
        ).toEqual([]);
      });

      it('handler idempotency: re-running up over migrated state is a no-op', async () => {
        const world = await makeWorld();
        await world.applyUpOnly();
        const migrated = await world.digest();

        if (meta.kind === 'db') {
          const { DB_MIGRATIONS } = await import('../framework/registry.gen');
          const migration = DB_MIGRATIONS[meta.id];
          expect(migration).toBeDefined();
          await world.run(async (ctx) => {
            const rows = await ctx.db.query(migration.table).collect();
            for (const doc of rows as never[]) {
              await migration.up(ctx as never, doc);
            }
          });
        } else if (meta.kind === 'node') {
          const { NODE_MIGRATIONS } =
            await import('../framework/registry.node.gen');
          const migration = NODE_MIGRATIONS[meta.id];
          expect(migration).toBeDefined();
          // Re-invoke the per-org handler through the REAL node runner action
          // (no planner/ledger gating): node handlers call `ctx.runAction`
          // (config-cache sync, install engines), which a mutation ctx from
          // `world.run` does not carry — only a real ActionCtx does.
          for (const org of world.orgs) {
            await world.t.action(
              internal.migrations.framework.node_runner.applyNodeForOrg,
              {
                migrationId: meta.id,
                orgId: org.id,
                orgSlug: org.slug,
                direction: 'up',
              },
            );
          }
        } else {
          const { COMPONENT_MIGRATIONS } =
            await import('../framework/registry.gen');
          const migration = COMPONENT_MIGRATIONS[meta.id];
          expect(migration).toBeDefined();
          await world.run(async (ctx) => {
            let cursor: string | null = null;
            for (let i = 0; i < 100; i++) {
              const res = await migration.up(
                ctx as never,
                cursor,
                migration.batchSize ?? 50,
              );
              if (res.isDone) return;
              cursor = res.continueCursor;
            }
            throw new Error('component idempotency probe did not drain');
          });
        }

        const again = await world.digest();
        const diff = diffWorldDigests(migrated, again);
        expect(
          diff,
          `re-running up(${meta.id}) over migrated state changed data:\n${diff.join('\n')}`,
        ).toEqual([]);
      });

      if (meta.destructive) {
        it('destructive up is refused without allowDestructive', async () => {
          const world = await makeWorld();
          const before = await world.digest();
          const res = await world.t.action(
            internal.migrations.framework.entrypoints.applyUp,
            { only: [meta.id] },
          );
          expect(res.completed).toEqual([]);
          expect(res.skipped.map((m: MigrationMeta) => m.id)).toContain(
            meta.id,
          );
          expect(diffWorldDigests(before, await world.digest())).toEqual([]);
        });
      }

      if (meta.kind === 'node') {
        it('fleet run records every org on the ledger', async () => {
          const world = await makeWorld();
          await world.applyUpOnly();
          const row = await world.ledgerRow();
          const processed = (row?.processedOrgs ?? []) as string[];
          expect(new Set(processed)).toEqual(
            new Set(world.orgs.map((o) => o.id)),
          );
        });
      }
    }

    for (const [name, fn] of Object.entries(spec.cases ?? {})) {
      it(`case: ${name}`, async () => {
        await fn(await makeWorld());
      });
    }

    for (const [name, fn] of Object.entries(spec.unit ?? {})) {
      it(`unit: ${name}`, async () => {
        await fn();
      });
    }
  });
}
