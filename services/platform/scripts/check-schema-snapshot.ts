/**
 * "Missing migration" guard. Fingerprints the live Convex schema and diffs it
 * against the committed baseline (`convex/migrations/schema.snapshot.json`).
 *
 * Convex validates EXISTING rows against the new schema at push time, so a
 * data-INCOMPATIBLE schema change (a field dropped/renamed/retyped, a required
 * field added, an optional field tightened, a union narrowed) needs a data
 * migration to reshape rows first — otherwise the deploy fails. This guard makes
 * such a change impossible to merge unnoticed: it fails the build and points at
 * the convex-migrations workflow.
 *
 * Data-SAFE growth (new tables, new optional fields, widened unions) passes
 * without forcing a snapshot rewrite — so routine schema PRs don't churn a
 * 1000-field JSON or fight merge conflicts across parallel branches.
 *
 *   bun scripts/check-schema-snapshot.ts          # check (CI)
 *   bun scripts/check-schema-snapshot.ts --write  # refresh the baseline
 *
 * Refresh the baseline (`--write`, also `bun run migrations:snapshot`) AFTER you
 * have added the migration that handles an incompatible change, and as part of
 * cutting a release.
 *
 * Scope: the Convex DB schema. File-based config (per-org JSON validated by
 * `lib/shared/schemas/*`) is a separate track guarded by its twin,
 * `check-config-snapshot.ts`; both run under `migrations:check`.
 *
 * Pure static check — imports the schema definition (no Convex backend needed).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeFingerprint,
  diffFingerprints,
  type SchemaFingerprint,
} from '../convex/migrations/framework/schema_fingerprint';
import schema from '../convex/schema';
import { parseYamlOrThrow, stringifyYaml } from '../lib/shared/config/yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(
  here,
  '../convex/migrations/schema.snapshot.yml',
);
// The baseline is large; the shared parser's default byte cap is for org
// config files, not fingerprints.
const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

function liveFingerprint(): SchemaFingerprint {
  // `SchemaDefinition.export()` is Convex's canonical JSON of every table. It is
  // a runtime method not surfaced in the public type, so reach it via Reflect.
  const exportFn = Reflect.get(schema, 'export');
  if (typeof exportFn !== 'function') {
    throw new Error(
      'convex schema has no export() method — convex API changed?',
    );
  }
  const exported: unknown = exportFn.call(schema);
  if (typeof exported !== 'string') {
    throw new Error('schema.export() did not return a JSON string.');
  }
  return computeFingerprint(exported);
}

/** Deterministic key order so baseline diffs stay reviewable. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

function main(): void {
  const write = process.argv.includes('--write');
  const current = liveFingerprint();

  if (write) {
    writeFileSync(SNAPSHOT_PATH, stringifyYaml(sortKeysDeep(current)));
    const tableCount = Object.keys(current.tables).length;
    console.log(
      `[check-schema-snapshot] wrote baseline — ${tableCount} table(s).`,
    );
    return;
  }

  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(
      '[check-schema-snapshot] no baseline at convex/migrations/schema.snapshot.yml.\n' +
        '  Create it with: bun run migrations:snapshot',
    );
    process.exit(1);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the baseline is this script's own write
  const baseline = parseYamlOrThrow(readFileSync(SNAPSHOT_PATH, 'utf8'), {
    maxBytes: SNAPSHOT_MAX_BYTES,
  }) as SchemaFingerprint;
  const changes = diffFingerprints(baseline, current);
  const incompatible = changes.filter((c) => c.kind === 'incompatible');
  const safe = changes.filter((c) => c.kind === 'safe');

  if (incompatible.length > 0) {
    console.error(
      '[check-schema-snapshot] FAILED — data-INCOMPATIBLE schema change(s) ' +
        'that would fail Convex push-time validation against existing rows:\n' +
        incompatible
          .map(
            (c) => `  - ${c.table}${c.field ? `.${c.field}` : ''}: ${c.detail}`,
          )
          .join('\n') +
        '\n\nExisting rows must be reshaped FIRST. Add a reversible, tested data ' +
        'migration under convex/migrations/versions/ (see the convex-migrations ' +
        'skill), THEN refresh the baseline with `bun run migrations:snapshot`.\n' +
        'If a change above is a deliberate, data-safe shape change that needs no ' +
        'migration, refreshing the baseline records that decision in the diff.',
    );
    process.exit(1);
  }

  if (safe.length > 0) {
    console.log(
      `[check-schema-snapshot] OK — ${safe.length} data-safe change(s) since ` +
        'the baseline (new tables / optional fields / widened unions); no ' +
        'migration needed.',
    );
    return;
  }

  console.log('[check-schema-snapshot] OK — schema matches the baseline.');
}

main();
