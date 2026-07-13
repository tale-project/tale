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
  /**
   * Set when live module blobs are missing on disk. Callers must treat this as
   * fatal — the deployment cannot be repaired by pruning.
   */
  integrityError: string | null;
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

/** Basename (no `.blob`) for a module blob path. */
export function moduleBlobBasename(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.blob$/, '');
}

/**
 * Live blob names the deployment references that are not present on disk.
 * Pure. Empty when every referenced blob has a matching `*.blob` file.
 */
export function findMissingReferencedModuleBlobs(
  referenced: ReadonlySet<string>,
  onDiskEntries: readonly ModuleBlobEntry[],
): string[] {
  const onDisk = new Set(onDiskEntries.map((e) => moduleBlobBasename(e.path)));
  const missing: string[] = [];
  for (const name of referenced) {
    if (!onDisk.has(name)) missing.push(name);
  }
  return missing.sort();
}

/**
 * An empty reference set with blobs still on disk means the reader found a
 * database but no live packages — treating that as "prune freely" would
 * recreate the mtime-only incident. Fail closed and skip the prune.
 */
export function shouldSkipPruneForEmptyReferences(
  referenced: ReadonlySet<string>,
  onDiskBlobCount: number,
): boolean {
  return referenced.size === 0 && onDiskBlobCount > 0;
}

/** Fatal message when live module blobs are missing from disk. */
export function formatModuleIntegrityError(missing: readonly string[]): string {
  const sample = missing.slice(0, 5).join(', ');
  const more = missing.length > 5 ? ` (+${missing.length - 5} more)` : '';
  return (
    `Local Convex module storage is incomplete: ${missing.length} live ` +
    `function-bundle blob(s) referenced by the deployment are missing on disk` +
    (sample ? ` (e.g. ${sample}${more})` : '') +
    '. Automatic prune cannot repair this — the bundle bytes are gone, so the ' +
    'deployment must be rebuilt. To rebuild WITHOUT losing local data, export ' +
    'it first (the backend still starts): run ' +
    '`bun run --filter @tale/platform convex:dev` (this bypasses the check) ' +
    'and, in another terminal, `cd services/platform && npx convex export ' +
    '--path convex-backup.zip`. Then reset and restore: `bun run setup:clean` ' +
    '(type `delete local convex`), `bun run dev`, then `cd services/platform && ' +
    'npx convex import --replace-all convex-backup.zip`. See contributor-setup ' +
    '(resetting local Convex dev data). Running setup:clean without exporting ' +
    'first permanently discards every local table, upload, and function.'
  );
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
 *
 * Always checks module integrity when references are known: missing live blobs
 * set `integrityError` and skip any prune. Callers must treat `integrityError`
 * as fatal (block Convex bring-up) — pruning cannot repair a half-deleted
 * deployment.
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
    integrityError: null,
  };

  if (deps.isBackendRunning()) {
    return {
      ...base,
      warning:
        'Skipped Convex local maintenance — convex-local-backend is still running. Stop dev first, then re-run.',
    };
  }

  const referenced = deps.readReferencedBlobNames();
  const entries = deps.listModuleBlobs();

  if (referenced !== null && referenced.size > 0) {
    const missing = findMissingReferencedModuleBlobs(referenced, entries);
    if (missing.length > 0) {
      return {
        ...base,
        integrityError: formatModuleIntegrityError(missing),
      };
    }
  }

  const needsWork =
    plan.kind === 'prune-modules' || plan.clearSnapshotArtifacts;
  if (!needsWork) return base;

  let removedModuleBlobs = 0;
  let freedBytes = 0;
  let pruneSkippedWarning: string | null = null;
  const pathsToRemove = [...snapshotArtifactPaths];

  if (plan.kind === 'prune-modules') {
    if (referenced === null) {
      // Can't tell which blobs the deployment still loads — deleting on mtime
      // alone would risk removing live component code. Skip, keep the data.
      pruneSkippedWarning =
        'Skipped Convex module prune — could not read the deployment’s ' +
        'module references from the local database, and pruning without them ' +
        'can delete live component code.';
    } else if (shouldSkipPruneForEmptyReferences(referenced, entries.length)) {
      // DB readable but no live packages found while blobs remain — fail
      // closed rather than treating "empty" as "prune everything by mtime".
      pruneSkippedWarning =
        'Skipped Convex module prune — the local database has module blobs ' +
        'on disk but no live package references were found. Pruning without ' +
        'references can delete live component code.';
    } else {
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

  // Re-check after deletes so a buggy selection cannot leave a half-dead tree.
  if (referenced !== null && referenced.size > 0 && removedModuleBlobs > 0) {
    const after = deps.listModuleBlobs();
    const missingAfter = findMissingReferencedModuleBlobs(referenced, after);
    if (missingAfter.length > 0) {
      return {
        action: 'none',
        removedModuleBlobs,
        removedSnapshotArtifacts: snapshotArtifactPaths.length,
        freedBytes,
        message: null,
        warning: plan.warning,
        integrityError: formatModuleIntegrityError(missingAfter),
      };
    }
  }

  const removedSnapshotArtifacts = snapshotArtifactPaths.length;
  const messages: string[] = [];
  if (removedModuleBlobs > 0) {
    messages.push(
      `Pruned ${removedModuleBlobs} stale Convex module blob(s) (${formatBytes(freedBytes)} freed; kept newest ${plan.kind === 'prune-modules' ? plan.keepCount : MODULE_BLOB_KEEP_COUNT}, never live references). ${plan.kind === 'prune-modules' ? plan.reason : ''}`.trim(),
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
    integrityError: null,
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
 * Basename (no `.blob`) from a package document's `storageKey`.
 * Convex local stores bare UUIDs or `modules/<uuid>.blob` — both normalize here.
 */
function packageStorageBlobName(storageKey: string): string {
  const name = storageKey.split('/').pop() ?? storageKey;
  return name.replace(/\.blob$/, '');
}

/**
 * Blob basenames the current deployment still references, read from the local
 * backend's SQLite (read-only; callers only prune while the backend is down).
 *
 * The join mirrors how the backend loads code:
 * 1. Latest live `_modules` rows name a `sourcePackageId`.
 * 2. That package's `storageKey` blob must exist on disk.
 * 3. Node action packages also set `externalPackageId` on the source package,
 *    pointing at a shared deps parent (postgres/jsdom/mcp bundles, etc.). The
 *    parent's `storageKey` must be kept too — pruning it yields InvalidModules
 *    ENOENT on `start_push` / node actions even when every module child blob
 *    is still present (July 2026 recurrence after the mtime-only fix).
 *
 * Everything else in `modules/` is history from superseded pushes and safe to
 * prune.
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

      const packagesById = new Map<string, Record<string, unknown>>();
      for (const doc of latestLive(
        "json_value LIKE '%storageKey%' AND json_value LIKE '%packageSize%'",
      ).values()) {
        if (typeof doc._id === 'string') {
          packagesById.set(doc._id, doc);
        }
      }

      const referenced = new Set<string>();
      const addPackageBlob = (packageId: string): void => {
        const doc = packagesById.get(packageId);
        if (!doc || typeof doc.storageKey !== 'string') return;
        referenced.add(packageStorageBlobName(doc.storageKey));
      };

      for (const packageId of currentPackageIds) {
        addPackageBlob(packageId);
        const doc = packagesById.get(packageId);
        // Node external-deps parent — required at runtime even though no
        // module lists it as sourcePackageId directly.
        if (typeof doc?.externalPackageId === 'string') {
          addPackageBlob(doc.externalPackageId);
        }
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
