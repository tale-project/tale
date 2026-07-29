/**
 * File-based-config "missing migration" guard — the config-side twin of
 * `check-schema-snapshot.ts`. Renders every Zod schema in `lib/shared/schemas/*`
 * to JSON Schema, fingerprints them, and diffs against the committed baseline
 * `convex/migrations/config.snapshot.json`.
 *
 * Per-org config lives in JSON files under `$TALE_CONFIG_DIR/<org>/<domain>/`
 * validated by those schemas. A change that makes existing on-disk files FAIL
 * validation (a new required field, a real retype, a narrowed enum/literal,
 * optional→required, a tightened constraint) needs a `node` migration to rewrite
 * the files first. This guard fails the build on such a change and points at the
 * convex-migrations workflow. Data-SAFE growth (new optional fields, widened
 * enums, removed fields — Zod strips unknown keys) passes without a rewrite.
 *
 *   bun scripts/check-config-snapshot.ts          # check (CI)
 *   bun scripts/check-config-snapshot.ts --write  # refresh the baseline
 *
 * See `lib/shared/config/config_fingerprint.ts` for the classifier + its two
 * documented limitations (strip vs `.strict()` is indistinguishable in JSON
 * Schema; `.refine()` cross-field rules aren't representable).
 *
 * Pure static check — imports the Zod schema modules (no Convex backend needed).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod/v4';

import {
  computeConfigFingerprint,
  diffConfigFingerprints,
  type ConfigFingerprint,
  type JsonSchema,
} from '../lib/shared/config/config_fingerprint';
import { parseYamlOrThrow, stringifyYaml } from '../lib/shared/config/yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.join(here, '../lib/shared/schemas');
const SNAPSHOT_PATH = path.join(
  here,
  '../convex/migrations/config.snapshot.yml',
);
// The baseline is large; the shared parser's default byte cap is for org
// config files, not fingerprints.
const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

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

function isZodSchema(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && '_zod' in value);
}

/** Import every schema module and render each exported Zod schema to JSON Schema. */
async function liveFingerprint(): Promise<ConfigFingerprint> {
  const files = readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();

  const raw: Record<string, JsonSchema> = {};
  for (const file of files) {
    const base = file.replace(/\.ts$/, '');
    const mod: Record<string, unknown> = await import(
      pathToFileURL(path.join(SCHEMAS_DIR, file)).href
    );
    for (const name of Object.keys(mod).sort()) {
      const value = mod[name];
      if (!isZodSchema(value)) continue;
      try {
        // unrepresentable:'any' renders refinements/customs as `{}` instead of throwing.
        raw[`${base}.${name}`] = z.toJSONSchema(value as z.ZodType, {
          unrepresentable: 'any',
        });
      } catch (err) {
        console.warn(
          `[check-config-snapshot] skipped ${base}.${name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  return computeConfigFingerprint(raw);
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const current = await liveFingerprint();

  if (write) {
    writeFileSync(SNAPSHOT_PATH, stringifyYaml(sortKeysDeep(current)));
    console.log(
      `[check-config-snapshot] wrote baseline — ${
        Object.keys(current.schemas).length
      } schema(s).`,
    );
    return;
  }

  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(
      '[check-config-snapshot] no baseline at convex/migrations/config.snapshot.yml.\n' +
        '  Create it with: bun run migrations:snapshot',
    );
    process.exit(1);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the baseline is this script's own write
  const baseline = parseYamlOrThrow(readFileSync(SNAPSHOT_PATH, 'utf8'), {
    maxBytes: SNAPSHOT_MAX_BYTES,
  }) as ConfigFingerprint;
  const changes = diffConfigFingerprints(baseline, current);
  const breaking = changes.filter((c) => c.kind === 'breaking');
  const safe = changes.filter((c) => c.kind === 'safe');

  if (breaking.length > 0) {
    console.error(
      '[check-config-snapshot] FAILED — config-schema change(s) that would break ' +
        'existing on-disk org config files:\n' +
        breaking
          .map(
            (c) => `  - ${c.schema}${c.path ? `.${c.path}` : ''}: ${c.detail}`,
          )
          .join('\n') +
        '\n\nExisting files must be reshaped FIRST. Add a reversible, tested `node` ' +
        'migration under convex/migrations/versions/ (the 01_governance_db_to_json ' +
        'migration is the model; see the convex-migrations skill), THEN refresh the ' +
        'baseline with `bun run migrations:snapshot`.\nIf a change above is a ' +
        'deliberate shape change that needs no file rewrite, refreshing the baseline ' +
        'records that decision in the diff.',
    );
    process.exit(1);
  }

  if (safe.length > 0) {
    console.log(
      `[check-config-snapshot] OK — ${safe.length} data-safe config change(s) ` +
        'since the baseline (new optional fields / widened enums / removed ' +
        'fields); no migration needed.',
    );
    return;
  }

  console.log(
    '[check-config-snapshot] OK — config schemas match the baseline.',
  );
}

void main();
