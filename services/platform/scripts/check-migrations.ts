/**
 * CI guard for the versioned data-migration framework. Fails the build when a
 * migration on disk is misconfigured, so a half-wired migration can never merge.
 *
 * Checks, for every `convex/migrations/versions/<semver>/<NN_slug>/` folder:
 *   1. Registration — its `meta.id` appears in the framework registry's
 *      `ALL_META` (else the runner/status never sees it).
 *   2. Test presence — a sibling `migration.test.ts` exists (so up/down are
 *      round-trip tested).
 *   3. Shape — `reversible === true`; a destructive RUNNABLE migration declares
 *      a non-`none` snapshot strategy (else `down` can't rebuild).
 *   4. Wiring — every runnable `db` migration is in `DB_MIGRATIONS`.
 *
 * Pure static check — no Convex backend required (the registry is plain data).
 * Run via `bun run migrations:check`.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_META,
  DB_MIGRATIONS,
} from '../convex/migrations/framework/registry';
import { isRunnableKind } from '../convex/migrations/framework/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = path.join(here, '../convex/migrations/versions');

const errors: string[] = [];
const seenIds = new Set(ALL_META.map((m) => m.id));

interface FolderMigration {
  folder: string;
  metaPath: string;
}

function discoverFolders(): FolderMigration[] {
  const out: FolderMigration[] = [];
  if (!existsSync(VERSIONS_DIR)) return out;
  for (const semver of readdirSync(VERSIONS_DIR)) {
    const semverDir = path.join(VERSIONS_DIR, semver);
    if (!statSync(semverDir).isDirectory()) continue;
    for (const slug of readdirSync(semverDir)) {
      const folder = path.join(semverDir, slug);
      if (!statSync(folder).isDirectory()) continue;
      const metaPath = path.join(folder, 'meta.ts');
      if (existsSync(metaPath)) out.push({ folder, metaPath });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const folders = discoverFolders();
  if (folders.length === 0) {
    console.warn('[check-migrations] no migration folders found.');
  }

  for (const { folder, metaPath } of folders) {
    const rel = path.relative(VERSIONS_DIR, folder);
    const mod: { meta?: unknown } = await import(metaPath);
    const meta = mod.meta as
      | {
          id: string;
          kind: string;
          reversible: boolean;
          destructive: boolean;
          snapshot: string;
        }
      | undefined;

    if (!meta || typeof meta.id !== 'string') {
      errors.push(`${rel}/meta.ts does not export a valid \`meta\`.`);
      continue;
    }

    // 1. Registration.
    if (!seenIds.has(meta.id)) {
      errors.push(
        `${rel} (id="${meta.id}") is not registered in framework/registry.ts ALL_META.`,
      );
    }

    // 2. Test presence.
    if (!existsSync(path.join(folder, 'migration.test.ts'))) {
      errors.push(
        `${rel} has no sibling migration.test.ts (up/down round-trip).`,
      );
    }

    // 3. Shape.
    if (!meta.reversible) {
      errors.push(`${rel} must be reversible:true (framework invariant).`);
    }
    if (
      meta.destructive &&
      isRunnableKind(meta.kind as never) &&
      meta.snapshot === 'none'
    ) {
      errors.push(
        `${rel} is destructive + runnable but declares snapshot:'none' — ` +
          `down could not rebuild the data.`,
      );
    }

    // 4. Wiring.
    if (meta.kind === 'db' && !(meta.id in DB_MIGRATIONS)) {
      errors.push(
        `${rel} is a runnable db migration but is missing from DB_MIGRATIONS.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error('[check-migrations] FAILED:\n  - ' + errors.join('\n  - '));
    process.exit(1);
  }
  console.log(
    `[check-migrations] OK — ${folders.length} migration folder(s), ` +
      `${ALL_META.length} registered.`,
  );
}

void main();
