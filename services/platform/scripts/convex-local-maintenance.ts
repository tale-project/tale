/**
 * Local Convex deployment maintenance for dev — keeps `convex_local_storage/modules/`
 * from growing without bound.
 *
 * The Convex CLI stores a new function-bundle blob on every `convex dev` push and
 * never garbage-collects old ones locally. Months of daily dev can accumulate tens
 * of thousands of blobs (10+ GB) and make cold starts fail inside the CLI's 30s
 * backend-ready window. This module plans and applies safe, host-side cleanup
 * BEFORE the dev orchestrator spawns `convex dev`.
 *
 * node-only by location; pure planning + injected I/O for tests.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isTruthy } from './dev-modes';

/** Keep this many newest module blobs after a prune. */
export const MODULE_BLOB_KEEP_COUNT = 1_000;

/** Prune when the modules dir exceeds either threshold. */
export const MODULE_BLOB_PRUNE_COUNT_THRESHOLD = 1_500;
export const MODULE_BLOB_PRUNE_BYTES_THRESHOLD = 2 * 1024 ** 3;

export interface ModuleBlobEntry {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface ModuleBlobStats {
  count: number;
  totalBytes: number;
}

export type MaintenanceAction =
  | { kind: 'none'; clearSnapshotArtifacts: boolean; warning: string | null }
  | {
      kind: 'prune-modules';
      reason: string;
      keepCount: number;
      clearSnapshotArtifacts: boolean;
      warning: string | null;
    };

export interface MaintenancePlanInput {
  moduleStats: ModuleBlobStats | null;
  configuredBackendVersion: string | null;
  latestBackendVersion: string | null;
  skipMaintenance: boolean;
}

export interface MaintenanceDeps {
  listModuleBlobs: () => ModuleBlobEntry[];
  removePaths: (paths: string[]) => void;
  isBackendRunning: () => boolean;
  /**
   * Blob basenames (no `.blob`) the current deployment still references —
   * see {@link readReferencedModuleBlobNames}. `null` = unknown (skip prune).
   */
  readReferencedBlobNames: () => ReadonlySet<string> | null;
}

export interface MaintenanceResult {
  action: 'none' | 'prune-modules';
  removedModuleBlobs: number;
  removedSnapshotArtifacts: number;
  freedBytes: number;
  message: string | null;
  warning: string | null;
}

/** Human-readable byte count for dev logs. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** Aggregate stats from a blob listing. Pure. */
export function summarizeModuleBlobs(
  entries: readonly ModuleBlobEntry[],
): ModuleBlobStats {
  let totalBytes = 0;
  for (const entry of entries) totalBytes += entry.sizeBytes;
  return { count: entries.length, totalBytes };
}

/**
 * Pick the blob paths to delete. Pure.
 *
 * A blob referenced by the CURRENT deployment must never be pruned — deleting
 * it breaks every function of the component it belongs to (components are
 * re-pushed rarely, so their blobs are often the OLDEST files in the dir; an
 * mtime-only prune deletes exactly the code the backend still loads, which is
 * how a July 2026 incident took out chat/crons/streaming on a dev machine).
 * `referenced` is the deployment's live blob-name set (basenames without
 * `.blob`):
 *  - `null` means the reference set could not be read — fail safe, prune
 *    nothing;
 *  - otherwise keep every referenced blob, and keep the `keepCount` newest
 *    (by mtime) of the unreferenced remainder.
 */
export function selectModuleBlobsToPrune(
  entries: readonly ModuleBlobEntry[],
  keepCount: number,
  referenced: ReadonlySet<string> | null,
): string[] {
  if (referenced === null) return [];
  const blobName = (path: string): string =>
    (path.split('/').pop() ?? path).replace(/\.blob$/, '');
  const prunable = entries.filter((e) => !referenced.has(blobName(e.path)));
  if (prunable.length <= keepCount) return [];
  const sorted = [...prunable].sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted.slice(keepCount).map((entry) => entry.path);
}

function backendVersionMismatchWarning(
  configuredBackendVersion: string | null,
  latestBackendVersion: string | null,
): string | null {
  if (
    !configuredBackendVersion ||
    !latestBackendVersion ||
    configuredBackendVersion === latestBackendVersion
  ) {
    return null;
  }
  return (
    `Local Convex was last run on backend ${configuredBackendVersion}; the CLI will use ${latestBackendVersion}. ` +
    'Dev data is kept — only stale module blobs and snapshot export artifacts are cleaned automatically. ' +
    'If cold start still fails, local Convex dev data may be corrupt; see contributor-setup (resetting local Convex dev data) before deleting anything.'
  );
}

/**
 * Decide whether to prune module blobs and/or clear snapshot artifacts.
 * Never schedules a full deployment reset — that stays a guarded manual script.
 * Pure given the inputs.
 */
export function planConvexLocalMaintenance(
  input: MaintenancePlanInput,
): MaintenanceAction {
  const warning = backendVersionMismatchWarning(
    input.configuredBackendVersion,
    input.latestBackendVersion,
  );
  const clearSnapshotArtifacts = warning !== null;

  if (input.skipMaintenance) {
    return { kind: 'none', clearSnapshotArtifacts: false, warning: null };
  }

  const { moduleStats } = input;
  if (!moduleStats || moduleStats.count === 0) {
    if (!clearSnapshotArtifacts) {
      return { kind: 'none', clearSnapshotArtifacts: false, warning };
    }
    return {
      kind: 'none',
      clearSnapshotArtifacts: true,
      warning,
    };
  }

  const overCount = moduleStats.count > MODULE_BLOB_PRUNE_COUNT_THRESHOLD;
  const overBytes = moduleStats.totalBytes > MODULE_BLOB_PRUNE_BYTES_THRESHOLD;
  if (!overCount && !overBytes) {
    if (!clearSnapshotArtifacts) {
      return { kind: 'none', clearSnapshotArtifacts: false, warning };
    }
    return {
      kind: 'none',
      clearSnapshotArtifacts: true,
      warning,
    };
  }

  const parts: string[] = [];
  if (overCount) {
    parts.push(
      `${moduleStats.count} module blobs (threshold ${MODULE_BLOB_PRUNE_COUNT_THRESHOLD})`,
    );
  }
  if (overBytes) {
    parts.push(
      `${formatBytes(moduleStats.totalBytes)} in module storage (threshold ${formatBytes(MODULE_BLOB_PRUNE_BYTES_THRESHOLD)})`,
    );
  }

  return {
    kind: 'prune-modules',
    reason: parts.join('; '),
    keepCount: MODULE_BLOB_KEEP_COUNT,
    clearSnapshotArtifacts,
    warning,
  };
}

/** Read `backendVersion` from the local Convex config, if present. */
export function readConfiguredBackendVersion(
  readFile: (path: string) => string,
  configPath: string,
): string | null {
  try {
    const parsed = JSON.parse(readFile(configPath)) as {
      backendVersion?: unknown;
    };
    return typeof parsed.backendVersion === 'string'
      ? parsed.backendVersion
      : null;
  } catch {
    return null;
  }
}

/**
 * The Convex CLI downloads precompiled backend binaries here; the lexicographic
 * last `precompiled-*` dir name is the one it will pick on the next dev run.
 */
export function resolveLatestCachedBackendVersion(
  listDir: (dir: string) => string[],
  cacheRoot = join(homedir(), '.cache', 'convex', 'binaries'),
): string | null {
  try {
    const names = listDir(cacheRoot)
      .filter((name) => name.startsWith('precompiled-'))
      .sort();
    return names.at(-1) ?? null;
  } catch {
    return null;
  }
}

/** List `*.blob` files under the modules storage dir. */
export function listModuleBlobEntries(
  readdir: (dir: string) => string[],
  stat: (path: string) => { mtimeMs: number; size: number },
  modulesDir: string,
): ModuleBlobEntry[] {
  try {
    return readdir(modulesDir)
      .filter((name) => name.endsWith('.blob'))
      .map((name) => {
        const path = join(modulesDir, name);
        const info = stat(path);
        return {
          path,
          mtimeMs: info.mtimeMs,
          sizeBytes: info.size,
        };
      });
  } catch {
    return [];
  }
}

/** Remove snapshot/export artifacts that bloat cold starts after a failed migration. */
export function staleSnapshotArtifactPaths(
  exists: (path: string) => boolean,
  readdir: (dir: string) => string[],
  defaultDir: string,
): string[] {
  const paths: string[] = [];
  const exportZip = join(defaultDir, 'export.zip');
  if (exists(exportZip)) paths.push(exportZip);

  for (const subdir of ['snapshot_imports', 'exports'] as const) {
    const dir = join(defaultDir, 'convex_local_storage', subdir);
    try {
      for (const name of readdir(dir)) {
        paths.push(join(dir, name));
      }
    } catch {
      // Missing dir is fine.
    }
  }
  return paths;
}

/**
 * Apply the maintenance plan. Refuses to run while `convex-local-backend` is up —
 * deleting blobs from under a live backend corrupts the deployment.
 */
export function applyConvexLocalMaintenance(
  plan: MaintenanceAction,
  deps: MaintenanceDeps,
  snapshotArtifactPaths: string[] = [],
): MaintenanceResult {
  const base: MaintenanceResult = {
    action: 'none',
    removedModuleBlobs: 0,
    removedSnapshotArtifacts: 0,
    freedBytes: 0,
    message: null,
    warning: plan.warning,
  };

  const needsWork =
    plan.kind === 'prune-modules' || plan.clearSnapshotArtifacts;
  if (!needsWork) return base;

  if (deps.isBackendRunning()) {
    return {
      ...base,
      warning:
        'Skipped Convex local maintenance — convex-local-backend is still running. Stop dev first, then re-run.',
    };
  }

  let removedModuleBlobs = 0;
  let freedBytes = 0;
  let pruneSkippedWarning: string | null = null;
  const pathsToRemove = [...snapshotArtifactPaths];

  if (plan.kind === 'prune-modules') {
    const referenced = deps.readReferencedBlobNames();
    if (referenced === null) {
      // Can't tell which blobs the deployment still loads — deleting on mtime
      // alone would risk removing live component code. Skip, keep the data.
      pruneSkippedWarning =
        'Skipped Convex module prune — could not read the deployment’s ' +
        'module references from the local database, and pruning without them ' +
        'can delete live component code.';
    } else {
      const entries = deps.listModuleBlobs();
      const toRemove = selectModuleBlobsToPrune(
        entries,
        plan.keepCount,
        referenced,
      );
      for (const entry of entries) {
        if (toRemove.includes(entry.path)) freedBytes += entry.sizeBytes;
      }
      pathsToRemove.push(...toRemove);
      removedModuleBlobs = toRemove.length;
    }
  }

  deps.removePaths(pathsToRemove);

  const removedSnapshotArtifacts = snapshotArtifactPaths.length;
  const messages: string[] = [];
  if (removedModuleBlobs > 0) {
    messages.push(
      `Pruned ${removedModuleBlobs} stale Convex module blob(s) (${formatBytes(freedBytes)} freed; kept newest ${plan.kind === 'prune-modules' ? plan.keepCount : MODULE_BLOB_KEEP_COUNT}). ${plan.kind === 'prune-modules' ? plan.reason : ''}`.trim(),
    );
  }
  if (removedSnapshotArtifacts > 0) {
    messages.push(
      `Removed ${removedSnapshotArtifacts} stale Convex snapshot export artifact(s).`,
    );
  }

  const warning =
    pruneSkippedWarning !== null
      ? plan.warning
        ? `${plan.warning} ${pruneSkippedWarning}`
        : pruneSkippedWarning
      : plan.warning;

  return {
    action: removedModuleBlobs > 0 ? 'prune-modules' : 'none',
    removedModuleBlobs,
    removedSnapshotArtifacts,
    freedBytes,
    message: messages.length > 0 ? messages.join(' ') : null,
    warning,
  };
}

/** True when dev maintenance should be skipped via env toggle. */
export function shouldSkipConvexMaintenance(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthy(env.TALE_DEV_SKIP_CONVEX_MAINTENANCE);
}

/** Paths under `services/platform` used by local Convex maintenance. */
export function convexLocalPaths(platformRoot: string) {
  const localDir = join(platformRoot, '.convex', 'local');
  const defaultDir = join(localDir, 'default');
  return {
    localDir,
    defaultDir,
    configPath: join(defaultDir, 'config.json'),
    modulesDir: join(defaultDir, 'convex_local_storage', 'modules'),
    sqlitePath: join(defaultDir, 'convex_local_backend.sqlite3'),
  };
}

/**
 * Blob basenames the current deployment still references, read from the local
 * backend's SQLite (read-only; callers only prune while the backend is down).
 *
 * The join mirrors how the backend loads code: the latest live revision of
 * every `_modules` row names its `sourcePackageId`; the latest live revision
 * of each of those source packages carries the `storageKey` whose blob file
 * must exist on disk. Everything else in `modules/` is history from
 * superseded pushes and safe to prune.
 *
 * Returns `null` when the references can't be established (unreadable DB,
 * missing driver, unexpected shape) — callers must then skip pruning. A
 * missing DB file returns an empty set: no deployment, no live references.
 * Revision timestamps exceed `Number.MAX_SAFE_INTEGER` (nanoseconds), so the
 * reduce compares BigInts via `safeIntegers`.
 */
export function readReferencedModuleBlobNames(
  sqlitePath: string,
  exists: (path: string) => boolean = existsSync,
): ReadonlySet<string> | null {
  if (!exists(sqlitePath)) return new Set();
  try {
    // Lazy so the pure planning half of this module stays importable outside
    // the Bun runtime (vitest runs on node).
    // oxlint-disable-next-line typescript/no-require-imports -- bun builtin
    const { Database } = require('bun:sqlite') as {
      Database: new (
        path: string,
        opts: { readonly: boolean; safeIntegers: boolean },
      ) => {
        query: (sql: string) => {
          all: () => {
            id: unknown;
            ts: bigint;
            deleted: unknown;
            v: string;
          }[];
        };
        close: () => void;
      };
    };
    const db = new Database(sqlitePath, {
      readonly: true,
      safeIntegers: true,
    });
    try {
      const latestLive = (
        like: string,
      ): Map<string, Record<string, unknown>> => {
        const rows = db
          .query(
            `SELECT id, ts, deleted, json_value v FROM documents WHERE ${like}`,
          )
          .all();
        const latest = new Map<
          string,
          { ts: bigint; deleted: unknown; v: string }
        >();
        for (const row of rows) {
          const key = String(row.id);
          const prev = latest.get(key);
          if (!prev || row.ts > prev.ts) latest.set(key, row);
        }
        const live = new Map<string, Record<string, unknown>>();
        for (const [key, row] of latest) {
          if (row.deleted) continue;
          live.set(key, JSON.parse(row.v) as Record<string, unknown>);
        }
        return live;
      };

      const currentPackageIds = new Set<string>();
      for (const doc of latestLive(
        "json_value LIKE '%sourcePackageId%' AND json_value LIKE '%analyzeResult%'",
      ).values()) {
        if (typeof doc.sourcePackageId === 'string') {
          currentPackageIds.add(doc.sourcePackageId);
        }
      }

      const referenced = new Set<string>();
      for (const doc of latestLive(
        "json_value LIKE '%storageKey%' AND json_value LIKE '%packageSize%'",
      ).values()) {
        if (typeof doc._id !== 'string' || !currentPackageIds.has(doc._id)) {
          continue;
        }
        if (typeof doc.storageKey !== 'string') continue;
        const name = doc.storageKey.split('/').pop() ?? doc.storageKey;
        referenced.add(name.replace(/\.blob$/, ''));
      }
      return referenced;
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      '[convex-maintenance] failed to read module references:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function isConvexBackendRunning(): boolean {
  try {
    const found = spawnSync('pgrep', ['-f', 'convex-local-backend'], {
      encoding: 'utf8',
    });
    return (found.stdout ?? '').trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Run maintenance before `convex dev` in the dev orchestrator. Safe to call when
 * external Convex mode is active — callers should skip earlier.
 */
export function runConvexLocalMaintenance(
  platformRoot: string,
): MaintenanceResult {
  const paths = convexLocalPaths(platformRoot);
  const entries = listModuleBlobEntries(
    readdirSync,
    (path) => statSync(path),
    paths.modulesDir,
  );
  const plan = planConvexLocalMaintenance({
    moduleStats: entries.length > 0 ? summarizeModuleBlobs(entries) : null,
    configuredBackendVersion: readConfiguredBackendVersion(
      (path) => readFileSync(path, 'utf8'),
      paths.configPath,
    ),
    latestBackendVersion: resolveLatestCachedBackendVersion(readdirSync),
    skipMaintenance: shouldSkipConvexMaintenance(),
  });

  const snapshotArtifactPaths = plan.clearSnapshotArtifacts
    ? staleSnapshotArtifactPaths(existsSync, readdirSync, paths.defaultDir)
    : [];

  return applyConvexLocalMaintenance(
    plan,
    {
      listModuleBlobs: () =>
        listModuleBlobEntries(
          readdirSync,
          (path) => statSync(path),
          paths.modulesDir,
        ),
      removePaths: (toRemove) => {
        for (const path of toRemove) {
          // Snapshot artifacts can be directories (extracted imports/exports),
          // so `recursive` is required — `force` only suppresses ENOENT, not EISDIR.
          rmSync(path, { force: true, recursive: true });
        }
      },
      isBackendRunning: isConvexBackendRunning,
      readReferencedBlobNames: () =>
        readReferencedModuleBlobNames(paths.sqlitePath),
    },
    snapshotArtifactPaths,
  );
}
