import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import * as logger from '../../utils/logger';
import type { AppliedMigration, MigrationsState } from './types';

const STATE_FILENAME = 'migrations.json';
/** Legacy one-bit marker written by v0.2.33. Migrated on first read. */
const LEGACY_MARKER = 'migration-pending';

function statePath(projectDir: string): string {
  return join(projectDir, '.tale', STATE_FILENAME);
}

function legacyMarkerPath(projectDir: string): string {
  return join(projectDir, '.tale', LEGACY_MARKER);
}

/**
 * Read the applied-migration list from `.tale/migrations.json`. If the file
 * doesn't exist but the legacy `.tale/migration-pending` marker is present,
 * treat that as "no migrations applied yet" (the legacy marker carried no
 * per-migration identity, so we must let each registered migration's detect()
 * re-discover any real pending work) and delete the legacy marker.
 */
export async function readMigrationsState(
  projectDir: string,
): Promise<MigrationsState> {
  const path = statePath(projectDir);
  if (!existsSync(path)) {
    const legacyPath = legacyMarkerPath(projectDir);
    if (existsSync(legacyPath)) {
      logger.debug(
        `Found legacy migration marker at ${legacyPath}; seeding empty migrations.json`,
      );
      await unlink(legacyPath).catch(() => {
        /* best-effort */
      });
    }
    return { applied: [] };
  }
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MigrationsState>;
    if (!parsed.applied || !Array.isArray(parsed.applied)) {
      return { applied: [] };
    }
    return { applied: parsed.applied };
  } catch (err) {
    logger.warn(
      `Could not parse ${path}: ${err instanceof Error ? err.message : String(err)}. Treating as empty.`,
    );
    return { applied: [] };
  }
}

export async function writeMigrationsState(
  projectDir: string,
  state: MigrationsState,
): Promise<void> {
  const path = statePath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

export async function recordApplied(
  projectDir: string,
  entry: AppliedMigration,
): Promise<void> {
  const state = await readMigrationsState(projectDir);
  if (state.applied.some((a) => a.id === entry.id)) {
    // Already recorded; nothing to do. This can happen on an idempotent
    // re-run of a migration whose detect() returned true by accident.
    return;
  }
  state.applied.push(entry);
  await writeMigrationsState(projectDir, state);
}

export function appliedIds(state: MigrationsState): Set<string> {
  return new Set(state.applied.map((a) => a.id));
}
