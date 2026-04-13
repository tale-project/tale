import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
    // Preserve the corrupt file for postmortem rather than silently losing
    // history. A truncated write (crash, disk full) can land here; the
    // operator will want to see the bytes that were there.
    const backupPath = `${path}.corrupted-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}`;
    await rename(path, backupPath).catch(() => {
      /* best-effort — if even rename fails, log and continue */
    });
    logger.warn(
      `Could not parse ${path}: ${err instanceof Error ? err.message : String(err)}. Moved to ${backupPath} and treating as empty.`,
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
  // Atomic write: write to a sibling tmp file then rename. rename(2) is
  // atomic on POSIX when source and destination are on the same filesystem,
  // so a crash during write leaves the previous migrations.json intact
  // instead of producing a truncated/parseable-as-empty file.
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmpPath, path);
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
