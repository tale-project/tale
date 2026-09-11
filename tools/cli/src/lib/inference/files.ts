import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { preconditionError } from '../../utils/fail';

export async function boundedJson(file: string): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4_194_304)
      throw preconditionError(
        'Inference metadata must be a bounded regular file.',
      );
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

export async function fileDigest(
  file: string,
  expectedBytes: number,
  privateUid?: number,
): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (
      privateUid !== undefined &&
      (before.uid !== privateUid || (before.mode & 0o777) !== 0o600)
    )
      throw preconditionError(
        'Inference private executable source must have its declared owner and mode 0600.',
      );
    if (!before.isFile() || before.size !== expectedBytes)
      throw preconditionError('Inference artifact size or file type differs.');
    const hash = createHash('sha256');
    let count = 0;
    for await (const chunk of createReadStream(file, {
      fd: handle.fd,
      autoClose: false,
    })) {
      count += chunk.length;
      if (count > expectedBytes)
        throw preconditionError('Inference artifact grew during verification.');
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (
      count !== expectedBytes ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw preconditionError(
        'Inference artifact changed during verification.',
      );
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** Destination directories are account-owned. Never follow an operator-supplied
 * symlink into a different user's files, including on a resumed deployment. */
export async function privateDirectory(
  directory: string,
  home: string,
  uid: number,
): Promise<void> {
  const root = resolve(home);
  const target = resolve(directory);
  if (!target.startsWith(root + sep))
    throw preconditionError(
      'Inference state must stay under its declared user home.',
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
        'Inference state has a symlink, foreign owner or writable ancestor.',
      );
  }
}

/** Existing account-owned state is the trust root, never a user-supplied mount.
 * Check each child before writing, including on interrupted download replay. */
export async function ownedDirectory(
  directory: string,
  state: string,
): Promise<void> {
  const owner = await lstat(state);
  await privateDirectory(directory, state, owner.uid);
}

export async function excludeRegenerableDirectory(
  directory: string,
  state: string,
): Promise<void> {
  await ownedDirectory(directory, state);
  const marker = join(directory, '.metadata_never_index');
  try {
    const file = await open(marker, 'wx', 0o600);
    await file.close();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
      throw error;
    const info = await lstat(marker);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== 0 ||
      info.uid !== (await lstat(state)).uid
    )
      throw preconditionError(
        'The regenerable-directory marker is not an empty owned file.',
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

export async function writePrivateText(
  file: string,
  text: string,
): Promise<void> {
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
      'Inference private state must be owned by its user with mode 0600.',
    );
  return boundedJson(file);
}

/** Existing bytes are retained, not overwritten when an artifact changes. */
export async function writePublicArtifact(
  file: string,
  text: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, 'wx', 0o644);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
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
