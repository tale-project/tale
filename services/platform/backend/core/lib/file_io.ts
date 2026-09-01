'use node';

/**
 * Shared file I/O primitives for file-based JSON storage.
 *
 * Used by both agents and workflows modules.
 * Provides atomic writes, symlink protection, history management,
 * and generic JSON file reading with validation.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename as fsRename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import { isValidOrgSlug as sharedIsValidOrgSlug } from '../../../lib/shared/constants/org-slug';
import { sortObjectKeysDeep } from '../../../lib/shared/utils/canonicalize-config';

const TIMESTAMP_REGEX = /^\d{13,}(-[a-f0-9]+)?$/;

export type FileReadResult<T> =
  | { ok: true; data: T; hash: string }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'corrupted'
        | 'too_large'
        | 'symlink'
        | 'inaccessible';
      message: string;
    };

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function isFileNotFound(err: unknown): boolean {
  return errnoCode(err) === 'ENOENT';
}

/**
 * Extract the POSIX errno code (e.g. `'ENOENT'`, `'EACCES'`) from a
 * `node:fs/promises` rejection. Returns `undefined` for non-fs errors.
 * Centralized so callers can distinguish "missing file" (expected) from
 * "permission denied" / "I/O error" (always worth logging) without
 * duplicating the property-check ceremony.
 */
/**
 * Apply the providers/-style ENOENT-vs-other discrimination to a
 * `readdir` error. ENOENT is the legitimate "directory doesn't exist
 * yet" case — every list-domain endpoint treats it as an empty result.
 * Any other errno (EACCES, EIO, EISDIR, …) means the operator misconfigured
 * the volume mount or there's a real fs problem; silently returning `[]`
 * makes the bug invisible. Log with a label so the source is identifiable
 * in `docker logs` and surface as an empty list to the caller so the
 * route still responds.
 *
 * Used to replace silent `catch {}` blocks at:
 *  - convex/agents/file_actions.ts (listAgents, duplicateAgent, listHistory)
 *  - convex/agents/internal_actions.ts (listAgentsInternal)
 *  - convex/workflows/file_actions.ts (listWorkflowsForAgent)
 */
export function handleDirReadError(err: unknown, label: string): void {
  if (errnoCode(err) === 'ENOENT') return;
  console.warn(
    `[${label}] readdir failed:`,
    err instanceof Error ? err.message : err,
  );
}

export function errnoCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export function validateOrgSlug(orgSlug: string): boolean {
  return sharedIsValidOrgSlug(orgSlug);
}

/**
 * Resolve the on-disk root for all org-scoped config from the
 * `TALE_CONFIG_DIR` env var. Each domain module used to inline its own
 * copy of this; centralizing prevents the error-message drift previous
 * reviews caught.
 *
 * Optional `area` suffix is included in the error message when the env
 * var is missing, so the operator sees which catalog they were trying
 * to access ("agents", "providers", etc.).
 */
export function getConfigRoot(area?: string): string {
  const configDir = process.env.TALE_CONFIG_DIR;
  if (configDir) return configDir;
  const suffix = area ? ` so ${area} can be resolved` : '';
  throw new Error(
    `TALE_CONFIG_DIR environment variable is not set. ` +
      `Set it to the root config directory ` +
      `(e.g., TALE_CONFIG_DIR=/path/to/tale/examples)${suffix}.`,
  );
}

/**
 * Join `name` onto `dir` and refuse anything that escapes `dir`.
 *
 * Catches `..`-style traversal as well as absolute-path injection.
 * Centralized so every domain module's resolver gets the same guard
 * with the same error shape — previous review found this block
 * copy-pasted in 9 places.
 *
 * Use this for the leaf-name leg only (after the org-slug has been
 * validated and joined). Pass a pre-validated `name` whose shape is
 * already restricted by a per-domain regex; this helper is a
 * defense-in-depth backstop, not the primary validator.
 */
export function safeJoinWithinDir(dir: string, name: string): string {
  // Empty name resolves to `dir` itself — every callable site of this
  // helper expects to land on a CHILD of `dir`, so an empty name is a
  // bug at the call site (likely an unvalidated empty string from user
  // input). Reject it explicitly rather than silently returning the
  // parent directory's path, which would let a caller `unlink` /
  // `rm -rf` the whole config root.
  if (name === '') {
    throw new Error('Path traversal detected: empty name');
  }
  const resolved = path.resolve(dir, name);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${name}`);
  }
  return resolved;
}

export function validateTimestamp(ts: string): boolean {
  return TIMESTAMP_REGEX.test(ts);
}

/**
 * Verify a resolved path is within the expected base directory,
 * following symlinks in intermediate directories via realpath.
 */
export async function verifyPathWithinBase(
  resolvedPath: string,
  baseDir: string,
): Promise<void> {
  let realBase: string;
  try {
    realBase = await realpath(baseDir);
  } catch {
    realBase = path.resolve(baseDir);
  }

  let realTarget: string;
  try {
    realTarget = await realpath(path.dirname(resolvedPath));
    realTarget = path.join(realTarget, path.basename(resolvedPath));
  } catch {
    realTarget = path.resolve(resolvedPath);
  }

  if (!realTarget.startsWith(realBase + path.sep) && realTarget !== realBase) {
    throw new Error('Path traversal detected');
  }
}

/**
 * Atomically write content to a file using temp → fsync → rename.
 * Cleans up the temp file on any error.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const randomSuffix = randomUUID().slice(0, 8);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${randomSuffix}.tmp`,
  );

  try {
    const fd = await open(
      tmpPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    );
    try {
      await fd.writeFile(content, 'utf-8');
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fsRename(tmpPath, filePath);
  } catch (err) {
    await cleanupTmp(tmpPath, 'atomicWrite');
    throw err;
  }
}

/**
 * Same as {@link atomicWrite} but creates the file with mode 0o600 so the
 * resulting credential file is owner-only. `chmod` after `open` defeats the
 * process umask, which would otherwise mask the requested mode down to 0o644
 * on most systems.
 */
export async function atomicWriteSecret(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const randomSuffix = randomUUID().slice(0, 8);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${randomSuffix}.tmp`,
  );

  try {
    const fd = await open(
      tmpPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await fd.chmod(0o600);
      await fd.writeFile(content, 'utf-8');
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fsRename(tmpPath, filePath);
  } catch (err) {
    await cleanupTmp(tmpPath, 'atomicWriteSecret');
    throw err;
  }
}

/**
 * Atomically write binary content to a file using temp → fsync → rename.
 * Same safety guarantees as {@link atomicWrite} but for Buffer data.
 */
export async function atomicWriteBuffer(
  filePath: string,
  content: Buffer,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const randomSuffix = randomUUID().slice(0, 8);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${randomSuffix}.tmp`,
  );

  try {
    const fd = await open(
      tmpPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    );
    try {
      await fd.writeFile(content);
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fsRename(tmpPath, filePath);
  } catch (err) {
    await cleanupTmp(tmpPath, 'atomicWriteBuffer');
    throw err;
  }
}

/**
 * Best-effort cleanup of a temp file after a failed atomic write. Swallows
 * ENOENT (the temp may already have been renamed away) but logs anything
 * else — leaving an unlink failure silent risks leaking a half-written
 * credentials tmp into the secrets dir indefinitely.
 */
async function cleanupTmp(tmpPath: string, label: string): Promise<void> {
  await unlink(tmpPath).catch((err: unknown) => {
    if (!isFileNotFound(err)) {
      console.warn(`[${label}] tmp cleanup failed for ${tmpPath}`, err);
    }
  });
}

/** Extensions a history snapshot can carry (one per superseded format). */
const HISTORY_SNAPSHOT_EXTENSIONS = ['.json', '.yml', '.md'];

/**
 * Prune history entries to keep only the most recent N. History snapshots
 * carry the format the superseded file had (`.yml` after the YAML cutover,
 * `.json` from before it, `.md` for the markdown-bodied skill documents), so
 * every one of those extensions counts against the cap — the timestamped
 * basenames keep the sort chronological across formats.
 */
export async function pruneHistory(
  historyDir: string,
  maxEntries: number,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(historyDir);
  } catch {
    return;
  }

  const snapshots = entries
    .filter((e) => HISTORY_SNAPSHOT_EXTENSIONS.some((ext) => e.endsWith(ext)))
    .sort();
  if (snapshots.length <= maxEntries) return;

  const toDelete = snapshots.slice(0, snapshots.length - maxEntries);
  await Promise.all(
    toDelete.map((f) =>
      unlink(path.join(historyDir, f)).catch((err: unknown) => {
        if (!isFileNotFound(err)) {
          console.warn(`[pruneHistory] failed to unlink ${f}`, err);
        }
      }),
    ),
  );
}

/**
 * Generate a unique history timestamp filename.
 * Includes a random suffix to prevent collisions on concurrent writes.
 */
export function generateHistoryTimestamp(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * Read a JSON file with symlink protection, size validation, and schema parsing.
 *
 * @param filePath - Absolute path to the JSON file.
 * @param maxSizeBytes - Maximum allowed file size in bytes.
 * @param parse - Function that parses and validates the file content. Should throw on invalid input.
 */
export async function readJsonFile<T>(
  filePath: string,
  maxSizeBytes: number,
  parse: (content: string) => T,
): Promise<FileReadResult<T>> {
  if (await isSymlink(filePath)) {
    return {
      ok: false,
      error: 'symlink',
      message: `Symlink rejected: ${path.basename(filePath)}`,
    };
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return {
      ok: false,
      error: 'not_found',
      message: `File not found: ${path.basename(filePath)}`,
    };
  }

  if (fileStat.size > maxSizeBytes) {
    return {
      ok: false,
      error: 'too_large',
      message: `File exceeds ${maxSizeBytes} bytes: ${path.basename(filePath)}`,
    };
  }

  let content: string;
  try {
    const fd = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      content = await fd.readFile('utf-8');
    } finally {
      await fd.close();
    }
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? err.code : undefined;
    const errorType =
      code === 'ENOENT'
        ? 'not_found'
        : code === 'EACCES' || code === 'EPERM'
          ? 'inaccessible'
          : 'inaccessible';
    return {
      ok: false,
      error: errorType,
      message: `Failed to read file: ${path.basename(filePath)} — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const data = parse(content);
    return { ok: true, data, hash: sha256(content) };
  } catch (err) {
    return {
      ok: false,
      error: 'corrupted',
      message: `Invalid JSON in ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Read a file safely using O_NOFOLLOW to prevent symlink-following.
 * Returns null if the file does not exist.
 */
export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const fd = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await fd.readFile('utf-8');
    } finally {
      await fd.close();
    }
  } catch (err) {
    if (!isFileNotFound(err)) {
      console.warn('[readFileSafe] failed:', filePath, err);
    }
    return null;
  }
}

/**
 * Delete a single file, tolerating a missing target (idempotent). A symlink
 * at the path is removed as a link (unlink never follows), so this cannot
 * reach outside the intended tree. Returns true when a file was removed.
 */
export async function removeFileSafe(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (err) {
    if (!isFileNotFound(err)) {
      console.warn('[removeFileSafe] failed:', filePath, err);
      throw err;
    }
    return false;
  }
}

/**
 * Recursively delete a directory, tolerating a missing target (idempotent).
 * Refuses a symlink at the directory path itself — following one with
 * `rm -rf` would delete arbitrary filesystem locations (same defense as
 * `organizations/scaffold.ts::removeOrgSubtree`). Returns true when a
 * directory was removed.
 */
export async function removeDirSafe(dirPath: string): Promise<boolean> {
  let info;
  try {
    info = await lstat(dirPath);
  } catch (err) {
    if (!isFileNotFound(err)) {
      console.warn('[removeDirSafe] lstat failed:', dirPath, err);
      throw err;
    }
    return false;
  }
  if (info.isSymbolicLink()) {
    throw new Error(`[removeDirSafe] refusing symlinked dir: ${dirPath}`);
  }
  await rm(dirPath, { recursive: true });
  return true;
}

/**
 * Byte-preserving sibling of `readFileSafe`. Returns the raw bytes of a
 * file, or null if the file does not exist. Use this for binary assets
 * (PNGs, PDFs, fonts) where the UTF-8 round-trip in `readFileSafe` would
 * corrupt non-text bytes.
 */
export async function readFileBufferSafe(
  filePath: string,
): Promise<Buffer | null> {
  try {
    const fd = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await fd.readFile();
    } finally {
      await fd.close();
    }
  } catch (err) {
    if (!isFileNotFound(err)) {
      console.warn('[readFileBufferSafe] failed:', filePath, err);
    }
    return null;
  }
}

/**
 * Serialize a JSON config, filtering out null/undefined/empty-array values
 * and sorting every object's keys so the on-disk form is canonical (stable
 * diffs, no key-order false positives in dirty-state comparison). Array
 * element order is preserved — it can be semantic; sort set-like arrays
 * explicitly via the per-domain canonicalizers in
 * `lib/shared/utils/canonicalize-config`.
 */
export function serializeJson(data: object): string {
  const cleaned = Object.fromEntries(
    Object.entries(data).filter(
      ([, v]) =>
        v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
    ),
  );
  return JSON.stringify(sortObjectKeysDeep(cleaned), null, 2) + '\n';
}

/**
 * Read a directory, distinguishing between "doesn't exist" and "inaccessible".
 * Returns entries on success, empty array if ENOENT, throws on other errors.
 */
export async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }
}
