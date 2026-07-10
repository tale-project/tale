/**
 * Corpus coverage guard: a runnable migration whose subjects the baseline
 * world corpus cannot exercise must not merge — otherwise the full-chain
 * integrity suite (convex/migrations/testing/chain.test.ts) silently stops
 * covering it and "chain green" overstates what was proven.
 *
 * For every runnable migration:
 *   - every `subjects.tables` entry must be declared in the world schema AND
 *     be seeded at baseline, produced by an earlier migration, or a
 *     framework table;
 *   - every `subjects.domains` entry must be a baseline config domain.
 * Plus manifest sanity: every baseline table exists in the world schema.
 *
 * Pure static check — no Convex backend. Runs under `migrations:check`.
 */

import { isRunnableKind } from '../convex/migrations/framework/types';
import { hasCheckpoint } from '../convex/migrations/testing/checkpoints.testkit';
import {
  baselineDomains,
  baselineTables,
  produces,
  WORLD_INJECTIONS,
} from '../convex/migrations/testing/world/manifest.testkit';
import { worldSchema } from '../convex/migrations/testing/world_schema.testkit';
import { discoverMigrations, validateSet } from './migrations-codegen';

/** Framework bookkeeping tables every migration may touch implicitly. */
const FRAMEWORK_TABLES = new Set([
  'migrationLedger',
  'migrationSnapshots',
  'configCache',
]);

/** Better Auth component pseudo-tables (`betterAuth:user`, …) — outside the
 *  world schema by construction; the component is seeded via support fns. */
const COMPONENT_SUBJECT_RE = /^betterAuth:/;

function worldTableNames(): Set<string> {
  const exportFn = Reflect.get(worldSchema, 'export');
  if (typeof exportFn !== 'function') {
    throw new Error('worldSchema has no export() — convex API changed?');
  }
  const parsed = JSON.parse(String(exportFn.call(worldSchema))) as {
    tables?: Array<{ tableName: string }>;
  };
  return new Set((parsed.tables ?? []).map((t) => t.tableName));
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const discoveryErrors: string[] = [];
  const migrations = await discoverMigrations(discoveryErrors);
  validateSet(migrations, discoveryErrors);
  if (discoveryErrors.length > 0) {
    // check-migrations owns reporting discovery problems; don't double-fail.
    console.log(
      '[check-migration-corpus] SKIPPED — discovery errors (see check-migrations).',
    );
    return;
  }

  const worldTables = worldTableNames();
  const covered = new Set<string>([
    ...baselineTables,
    ...Object.values(produces).flat(),
    ...WORLD_INJECTIONS.flatMap((i) => i.tables),
    ...FRAMEWORK_TABLES,
  ]);
  const domains = new Set(baselineDomains);

  for (const table of baselineTables) {
    if (!worldTables.has(table)) {
      errors.push(
        `manifest baselineTables lists "${table}" but world_schema.testkit.ts does not declare it.`,
      );
    }
  }
  for (const injection of WORLD_INJECTIONS) {
    if (!hasCheckpoint(injection.afterVersion)) {
      errors.push(
        `injection afterVersion "${injection.afterVersion}" has no version checkpoint — run bun scripts/dump-version-schemas.ts.`,
      );
    }
    for (const table of injection.tables) {
      if (!worldTables.has(table)) {
        errors.push(
          `injection (${injection.afterVersion}) table "${table}" is not declared in world_schema.testkit.ts.`,
        );
      }
    }
  }

  let guarded = 0;
  for (const m of migrations) {
    // Every migration version must have a ground-truth checkpoint so the
    // versions suite can hold the chain against the real released schema.
    if (!hasCheckpoint(m.semver)) {
      errors.push(
        `${m.rel}: version ${m.semver} has no checkpoint fixture (testing/versions/) — run bun scripts/dump-version-schemas.ts.`,
      );
    }
    if (!isRunnableKind(m.kind)) continue;
    guarded++;
    for (const table of m.subjects?.tables ?? []) {
      if (COMPONENT_SUBJECT_RE.test(table)) continue;
      if (!worldTables.has(table)) {
        errors.push(
          `${m.rel}: subject table "${table}" is not declared in world_schema.testkit.ts — the chain world cannot hold it.`,
        );
      }
      if (!covered.has(table)) {
        errors.push(
          `${m.rel}: subject table "${table}" is neither seeded at baseline, produced by an earlier migration (manifest \`produces\`), injected at a version boundary (world/injections.testkit.ts), nor framework bookkeeping — extend the corpus or declare the producer.`,
        );
      }
    }
    for (const domain of m.subjects?.domains ?? []) {
      if (!domains.has(domain)) {
        errors.push(
          `${m.rel}: subject domain "${domain}" is not a baseline config domain — extend the fixture trees + manifest.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error(
      '[check-migration-corpus] FAILED:\n  - ' + errors.join('\n  - '),
    );
    process.exit(1);
  }
  console.log(
    `[check-migration-corpus] OK — every subject of ${guarded} runnable migration(s) is corpus-covered.`,
  );
}

void main();
