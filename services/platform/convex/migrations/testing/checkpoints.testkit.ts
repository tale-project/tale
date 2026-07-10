/**
 * Version checkpoints: the ground truth of every release, extracted from git
 * tags by `scripts/dump-version-schemas.ts` into a content-addressed store
 * under `testing/versions/` (`index.json` + gzipped blobs):
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import type { SchemaFingerprint } from '../framework/schema_fingerprint';
import { validateDoc } from './schema_validate.testkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(here, 'versions');
const INDEX_PATH = path.join(FIXTURES_DIR, 'index.json');

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
    indexCache = JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as Record<
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
 * relative layout below `builtin-configs/`. Returns the written file count.
 */
export function materializeScaffold(
  version: string,
  targetDir: string,
): number {
  const manifest = loadScaffold(version);
  let written = 0;
  for (const [rel, blobKey] of Object.entries(manifest.files)) {
    const below = rel.replace(/^builtin-configs\//, '');
    const target = path.join(targetDir, below);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readBlob(blobKey));
    written++;
  }
  return written;
}

/**
 * Validate a migrated world against the DB schema release `version` actually
 * shipped. `collect` reads all rows of a table (the chain's world collector).
 * Returns human-readable violations; empty = the world is a valid deployment
 * of that release.
 */
export async function validateWorldAtVersion(
  version: string,
  worldTables: readonly string[],
  collect: (table: string) => Promise<Array<Record<string, unknown>>>,
): Promise<string[]> {
  const checkpoint = loadDbCheckpoint(version);
  const errors: string[] = [];

  for (const table of worldTables) {
    if (CHECKPOINT_EXEMPT_TABLES.has(table)) continue;
    const rows = await collect(table);
    if (rows.length === 0) continue;

    const shape = checkpoint.tables[table];
    if (!shape) {
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
