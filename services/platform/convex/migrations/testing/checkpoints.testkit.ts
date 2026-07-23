/**
 * Version checkpoints: the ground truth of every release, extracted from git
 * tags by `scripts/dump-version-schemas.ts` into a content-addressed store
 * under `testing/versions/` (`index.yml` + gzipped blobs):
 *
 *   dbSchema     — the Convex schema fingerprint the release shipped
 *   configSchema — the org-config (Zod → JSON Schema) fingerprint
 *   scaffold     — what an INITIALIZED project of that era contains: the
 *                  builtin-configs catalog as path → content-hash manifest
 *                  (reference code/docs/images excluded)
 *
 * The contract a checkpoint enforces — "after every migration ≤ X, the world
 * must be a valid release-X deployment" — is what makes version mis-homing a
 * test failure instead of a production incident:
 *
 *   - a row in a table release X does NOT declare ⇒ the migration that
 *     created it belongs to a LATER version (on a real X deployment those
 *     rows would be invisible to the app);
 *   - a row carrying fields release X does not declare, or missing fields it
 *     requires ⇒ the transform belongs to a different version than claimed.
 *
 * Two-dot basename: test-only module, excluded from the Convex bundle.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { parseYamlOrThrow } from '../../../lib/shared/config/yaml';
import type { SchemaFingerprint } from '../framework/schema_fingerprint';
import {
  configSchemaCandidates,
  validateJsonValue,
  type JsonSchemaNode,
} from './config_validate.testkit';
import { validateDoc } from './schema_validate.testkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(here, 'versions');
const INDEX_PATH = path.join(FIXTURES_DIR, 'index.yml');

export type CheckpointKind = 'dbSchema' | 'configSchema' | 'scaffold';

export interface ConfigCheckpoint {
  /** "<schemaFile>.<exportName>" → its (annotation-stripped) JSON Schema. */
  readonly schemas: Record<string, Record<string, unknown>>;
}

export interface ScaffoldManifest {
  /** repo-relative builtin-configs path → content blob key. */
  readonly files: Record<string, string>;
}

/**
 * World tables a release checkpoint never judges:
 *  - migrationLedger/migrationSnapshots: the framework's own bookkeeping —
 *    the simulated world needs them at every version, including releases
 *    that predate the framework;
 *  - configCache: a derived mirror populated by TODAY'S sync actions (the
 *    world runs current code for file→cache syncs) — its coherence is
 *    asserted against the files, not against historical schemas.
 */
const CHECKPOINT_EXEMPT_TABLES = new Set([
  'migrationLedger',
  'migrationSnapshots',
  'configCache',
]);

let indexCache: Record<string, Partial<Record<CheckpointKind, string>>> | null =
  null;

function loadIndex(): Record<string, Partial<Record<CheckpointKind, string>>> {
  if (!indexCache) {
    if (!existsSync(INDEX_PATH)) {
      throw new Error(
        'no version checkpoint index — run `bun scripts/dump-version-schemas.ts`',
      );
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the index is the dump script's own write
    indexCache = parseYamlOrThrow(readFileSync(INDEX_PATH, 'utf-8')) as Record<
      string,
      Partial<Record<CheckpointKind, string>>
    >;
  }
  return indexCache;
}

export function checkpointVersions(): string[] {
  return Object.keys(loadIndex());
}

export function hasCheckpoint(version: string): boolean {
  return loadIndex()[version]?.dbSchema !== undefined;
}

export function readBlob(key: string): string {
  const blobPath = path.join(FIXTURES_DIR, 'blobs', `${key}.json.gz`);
  if (!existsSync(blobPath)) {
    throw new Error(`missing checkpoint blob ${key} — regenerate the fixtures`);
  }
  return gunzipSync(readFileSync(blobPath)).toString('utf-8');
}

function blobOf(version: string, kind: CheckpointKind): string {
  const key = loadIndex()[version]?.[kind];
  if (!key) {
    throw new Error(
      `no ${kind} checkpoint for version ${version} — run \`bun scripts/dump-version-schemas.ts\``,
    );
  }
  return readBlob(key);
}

export function loadDbCheckpoint(version: string): SchemaFingerprint {
  return JSON.parse(blobOf(version, 'dbSchema')) as SchemaFingerprint;
}

export function loadConfigCheckpoint(version: string): ConfigCheckpoint {
  return JSON.parse(blobOf(version, 'configSchema')) as ConfigCheckpoint;
}

export function loadScaffold(version: string): ScaffoldManifest {
  return JSON.parse(blobOf(version, 'scaffold')) as ScaffoldManifest;
}

/**
 * Materialize the version's builtin scaffold (what a fresh project of that
 * era was initialized from) into `targetDir`, preserving the catalog's
 * relative layout below its era's root — `builtin-configs/` for pre-rewrite
 * releases, `configs/platform/custom/` since the config-system rewrite.
 * Returns the written file count.
 */
export function materializeScaffold(
  version: string,
  targetDir: string,
): number {
  const manifest = loadScaffold(version);
  let written = 0;
  for (const [rel, blobKey] of Object.entries(manifest.files)) {
    const below = rel
      .replace(/^builtin-configs\//, '')
      .replace(/^configs\/platform\/custom\//, '');
    const target = path.join(targetDir, below);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readBlob(blobKey));
    written++;
  }
  return written;
}

/**
 * Validate every org-config JSON file under `configRoot` against the config
 * schemas release `version` actually shipped. A file maps to its schema key
 * via `configSchemaCandidates`; a version where no candidate key exists did
 * not know the shape yet and skips the file (never a false positive).
 * Returns human-readable violations; empty = every known file parses and
 * matches that release's shape.
 */
export function validateConfigTreeAtVersion(
  version: string,
  configRoot: string,
): string[] {
  const checkpoint = loadConfigCheckpoint(version);
  const errors: string[] = [];

  const walk = (dir: string, orgRel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // sidecars, .gitkeep, dotfiles
      const abs = path.join(dir, entry.name);
      const rel = orgRel === '' ? entry.name : `${orgRel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;

      const key = configSchemaCandidates(rel).find(
        (candidate) => checkpoint.schemas[candidate] !== undefined,
      );
      if (!key) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(abs, 'utf-8'));
      } catch (err) {
        errors.push(
          `release ${version}: ${rel} is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
        );
        continue;
      }
      const schema = checkpoint.schemas[key] as JsonSchemaNode;
      const violation = validateJsonValue(parsed, schema, rel);
      if (violation) {
        errors.push(`release ${version} (${key}): ${violation}`);
      }
    }
  };

  for (const orgDir of readdirSync(configRoot, { withFileTypes: true })) {
    if (!orgDir.isDirectory() || orgDir.name.startsWith('.')) continue;
    walk(path.join(configRoot, orgDir.name), '');
  }
  return errors;
}

/**
 * Table names declared by ANY checkpoint up to and including `version` —
 * distinguishes a table a release DROPPED (orphan rows are legitimate
 * residue: Convex keeps undeclared tables' data) from one no release had
 * ever declared (rows there prove a migration belongs to a later version).
 * Cached per call site: the full scan gunzips every checkpoint once.
 */
export function tablesEverDeclaredThrough(version: string): Set<string> {
  const ordered = checkpointVersions()
    .map((v) => ({
      v,
      key: v
        .split('.')
        .map((p) => p.padStart(6, '0'))
        .join('.'),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const targetKey = version
    .split('.')
    .map((p) => p.padStart(6, '0'))
    .join('.');
  const seen = new Set<string>();
  for (const { v, key } of ordered) {
    if (key.localeCompare(targetKey) > 0) break;
    for (const table of Object.keys(loadDbCheckpoint(v).tables)) {
      seen.add(table);
    }
  }
  return seen;
}

/**
 * Validate a migrated world against the DB schema release `version` actually
 * shipped. `collect` reads all rows of a table (the chain's world collector).
 * Returns human-readable violations; empty = the world is a valid deployment
 * of that release.
 *
 * `everDeclared` (when provided) marks tables some release ≤ `version` once
 * declared: rows in an undeclared-but-once-declared table are DROP RESIDUE,
 * not mis-homing evidence, and are skipped.
 */
export async function validateWorldAtVersion(
  version: string,
  worldTables: readonly string[],
  collect: (table: string) => Promise<Array<Record<string, unknown>>>,
  everDeclared?: ReadonlySet<string>,
): Promise<string[]> {
  const checkpoint = loadDbCheckpoint(version);
  const errors: string[] = [];

  for (const table of worldTables) {
    if (CHECKPOINT_EXEMPT_TABLES.has(table)) continue;
    const rows = await collect(table);
    if (rows.length === 0) continue;

    const shape = checkpoint.tables[table];
    if (!shape) {
      if (everDeclared?.has(table)) continue; // dropped table — orphan rows
      errors.push(
        `release ${version} does not declare table "${table}", but the migrations left ${rows.length} row(s) in it — ` +
          'the migration that created them belongs to a later version.',
      );
      continue;
    }
    for (const row of rows) {
      const err = validateDoc(row, shape, table);
      if (err) {
        errors.push(`release ${version}: ${err}`);
        break; // one precise error per table keeps the report readable
      }
    }
  }
  return errors;
}
