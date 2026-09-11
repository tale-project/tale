import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { preconditionError } from '../../utils/fail';

export async function boundedJson(file: string): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4_194_304)
      throw preconditionError(
        'Deployment metadata must be a bounded regular file.',
      );
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

export async function privateDirectory(
  directory: string,
  home: string,
  uid: number,
): Promise<void> {
  const root = resolve(home);
  const target = resolve(directory);
  if (!target.startsWith(root + sep))
    throw preconditionError(
      'Deployment state must stay under its declared user home.',
    );
  let current = root;
  for (const part of ['', ...target.slice(root.length + 1).split(sep)]) {
    if (part) current = join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST')
      )
        throw error;
    }
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== uid ||
      (info.mode & 0o022) !== 0
    )
      throw preconditionError(
        'Deployment state has a symlink, foreign owner or writable ancestor.',
      );
  }
}

/** Caller holds the existing kernel-backed deployment lock. fsync precedes
 * atomic publication; a crash cannot make partial JSON look like a receipt. */
export async function writePrivateJson(
  file: string,
  value: unknown,
): Promise<void> {
  return writePrivateText(file, JSON.stringify(value, null, 2) + '\n');
}

async function writePrivateText(file: string, text: string): Promise<void> {
  const temporary = file + '.tmp.' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function readPrivateJson(
  file: string,
  uid: number,
): Promise<unknown> {
  const info = await lstat(file);
  if (info.uid !== uid || (info.mode & 0o077) !== 0)
    throw preconditionError(
      'Deployment private state must be owned by its user with mode 0600.',
    );
  return boundedJson(file);
}

export async function readOptionalJson(file: string): Promise<unknown> {
  try {
    return await boundedJson(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
}
