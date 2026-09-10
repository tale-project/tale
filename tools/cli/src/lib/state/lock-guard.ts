import { constants, Database } from 'bun:sqlite';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { preconditionError } from '../../utils/fail';

/** SQLite owns the OS lock for the lifetime of this connection. Moving a stale
 * PID file aside exposes a path another caller can acquire. This coordination
 * file is never unlinked or renamed, so contenders lock the same inode and
 * process exit releases ownership. It stores no application data. The scope is
 * one host and a local filesystem; Bun ships SQLite on every CLI platform. */
const held = new Map<string, Database>();

async function regularPath(path: string, directory: boolean): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    )
      throw preconditionError(
        'Deployment lock path must be regular, never a symlink or shared file.',
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function key(directory: string, create = false): Promise<string | null> {
  const selected = resolve(directory);
  if (!(await regularPath(selected, true))) {
    if (!create) return null;
    await mkdir(selected, { recursive: true, mode: 0o700 });
    await regularPath(selected, true);
  }
  // Parent aliases such as macOS /var are valid. The selected directory itself
  // must be regular, and every alias uses the same canonical lock identity.
  return realpath(selected);
}

/** Read-side admission is reusable before metadata access; it never creates a
 * directory unless acquisition explicitly requests it. */
export async function validateLockPaths(
  directory: string,
  create = false,
): Promise<string | null> {
  const canonical = await key(directory, create);
  if (!canonical) return null;
  const metadata = join(canonical, '.tale');
  if (!(await regularPath(metadata, true))) {
    if (!create) return canonical;
    try {
      await mkdir(metadata, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await regularPath(metadata, true);
  }
  for (const name of [
    'deployment-lock',
    'deployment-lock.sqlite',
    'deployment-lock.sqlite-journal',
    'deployment-lock.sqlite-wal',
    'deployment-lock.sqlite-shm',
  ])
    await regularPath(join(metadata, name), false);
  return canonical;
}

export async function acquireGuard(directory: string): Promise<boolean> {
  const canonical = await validateLockPaths(directory, true);
  if (!canonical)
    throw preconditionError('Deployment lock directory is unavailable.');
  if (held.has(canonical)) return false;
  const database = new Database(
    join(canonical, '.tale', 'deployment-lock.sqlite'),
    constants.SQLITE_OPEN_READWRITE |
      constants.SQLITE_OPEN_CREATE |
      constants.SQLITE_OPEN_NOFOLLOW,
  );
  try {
    database.exec('PRAGMA busy_timeout = 250; BEGIN EXCLUSIVE;');
    held.set(canonical, database);
    return true;
  } catch (error) {
    database.close();
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_BUSY'
    )
      return false;
    throw error;
  }
}

export async function releaseGuard(directory: string): Promise<void> {
  const canonical = await key(directory);
  if (!canonical) return;
  const database = held.get(canonical);
  if (!database) return;
  held.delete(canonical);
  // Closing rolls back the empty transaction. Its stable file stays in place.
  database.close(true);
}

export async function ownsGuard(directory: string): Promise<boolean> {
  const canonical = await key(directory);
  return canonical !== null && held.has(canonical);
}
