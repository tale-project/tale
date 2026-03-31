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
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

const ORG_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
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

export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export function validateOrgSlug(orgSlug: string): boolean {
  return orgSlug === 'default' || ORG_SLUG_REGEX.test(orgSlug);
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
    await unlink(tmpPath).catch(() => {});
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
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Prune history entries to keep only the most recent N.
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

  const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();
  if (jsonFiles.length <= maxEntries) return;

  const toDelete = jsonFiles.slice(0, jsonFiles.length - maxEntries);
  await Promise.all(
    toDelete.map((f) => unlink(path.join(historyDir, f)).catch(() => {})),
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
  } catch {
    return null;
  }
}

/**
 * Serialize a JSON config, filtering out null/undefined/empty-array values.
 */
export function serializeJson(data: object): string {
  const cleaned = Object.fromEntries(
    Object.entries(data).filter(
      ([, v]) =>
        v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
    ),
  );
  return JSON.stringify(cleaned, null, 2) + '\n';
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
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
