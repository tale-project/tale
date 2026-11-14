import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

import { IncusApiError, type IncusInstance } from '@tale/incus/api';
import {
  makeDirectory,
  readFile as readIncusFile,
  statFile,
  writeFile as writeIncusFile,
  type IncusFileTarget,
} from '@tale/incus/files';

import type {
  CopyOutOptions,
  CopyResult,
  ExecResult,
  FileOwner,
} from '../../types';
import type { IncusVerbContext } from './exec';
import { passwdUser } from './image-facts-cache';

/**
 * Copies into and out of an instance on Incus (design 4.1, R-08), over the
 * file APIs instead of `docker cp`:
 * - A path on one of the stack's volumes (the config store `config-data` at
 *   `/app/data` above all, which the platform mounts read-only) goes through
 *   the volume's file API, which writes whether or not, and however, an
 *   instance mounts it. Any other path goes through the instance's file API.
 * - Each file and directory is written with its owner and mode in the same
 *   request: the owner `copyIn` is given (names resolved in the instance's
 *   own `/etc/passwd` and `/etc/group`), else root, as `docker cp` leaves
 *   them; the mode is the local one.
 * - `copyOut` walks the directory with the file API and stops at its byte
 *   cap and its deadline; the local files are 0600, the directories 0700.
 *   A symlink is not followed and not copied (a warning names it).
 */

/** The largest `/etc/passwd` or `/etc/group` read for an owner. */
const ACCOUNTS_MAX_BYTES = 256 * 1024;
/** The largest directory listing read (it is not counted in the cap). */
const LISTING_MAX_BYTES = 4 * 1024 * 1024;

/** Where a path in the instance is read and written. */
export interface FilePlace {
  target: IncusFileTarget;
  /** The path as that target names it. */
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The file API that holds `path`: the volume of the stack mounted at the
 * longest prefix of it, else the instance itself.
 */
export async function placeOf(
  context: IncusVerbContext,
  instance: IncusInstance,
  path: string,
): Promise<FilePlace> {
  const clean = posix.normalize(path);
  let best: { pool: string; volume: string; mount: string } | undefined;
  for (const device of Object.values(instance.devices)) {
    if (!isRecord(device) || device.type !== 'disk') continue;
    const { pool, source, path: mount } = device;
    if (
      typeof pool !== 'string' ||
      typeof source !== 'string' ||
      typeof mount !== 'string' ||
      mount === '/'
    )
      continue;
    const root = posix.normalize(mount).replace(/\/+$/, '');
    if (clean !== root && !clean.startsWith(`${root}/`)) continue;
    if (best !== undefined && best.mount.length >= root.length) continue;
    best = { pool, volume: source, mount: root };
  }
  if (best !== undefined) {
    const volume = await context.client.getVolume(best.pool, best.volume);
    if (volume?.config['user.tale.stack'] === context.stack)
      return {
        target: { pool: best.pool, volume: best.volume },
        path: posix.join('/', posix.relative(best.mount, clean)),
      };
  }
  return { target: { instance: instance.name }, path: clean };
}

/** The gid of `group` in an `/etc/group`; a number names itself. */
function groupId(file: string, group: string): number | null {
  if (/^\d+$/.test(group)) return Number(group);
  for (const line of file.split('\n')) {
    const fields = line.split(':');
    if (fields[0] !== group || fields.length < 3) continue;
    const gid = Number(fields[2]);
    return Number.isSafeInteger(gid) ? gid : null;
  }
  return null;
}

/** The uid and gid of `owner` as the instance's own accounts name them. */
async function resolveOwner(
  context: IncusVerbContext,
  name: string,
  owner: FileOwner,
): Promise<{ uid: number; gid: number }> {
  const read = async (path: string) => {
    const file = await readIncusFile(context.client, { instance: name }, path, {
      maxBytes: ACCOUNTS_MAX_BYTES,
    });
    return file?.type === 'file' ? new TextDecoder().decode(file.content) : '';
  };
  const uid = /^\d+$/.test(owner.user)
    ? Number(owner.user)
    : (passwdUser(await read('/etc/passwd'), owner.user)?.uid ?? null);
  const gid = groupId(await read('/etc/group'), owner.group);
  if (uid === null)
    throw new Error(`${name} has no user ${owner.user} in its /etc/passwd.`);
  if (gid === null)
    throw new Error(`${name} has no group ${owner.group} in its /etc/group.`);
  return { uid, gid };
}

function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Copy the contents of the local `dir` into `target` in the instance. */
export async function copyIntoInstance(
  context: IncusVerbContext,
  name: string,
  dir: string,
  target: string,
  owner?: FileOwner,
): Promise<CopyResult> {
  const read = await context.client.getInstance(name);
  if (read === undefined)
    return {
      success: false,
      stage: 'copy',
      detail: `There is no instance ${name}.`,
    };
  let ids: { uid: number; gid: number };
  try {
    ids =
      owner === undefined
        ? { uid: 0, gid: 0 }
        : await resolveOwner(context, name, owner);
  } catch (error) {
    return { success: false, stage: 'owner', detail: detailOf(error) };
  }
  try {
    const place = await placeOf(context, read.instance, target);
    if (
      place.path !== '/' &&
      (await statFile(context.client, place.target, place.path)) === undefined
    )
      await makeDirectory(context.client, place.target, place.path, {
        ...ids,
        mode: octal((await lstat(dir)).mode),
      });
    await copyTree(context, place, dir, ids);
    return { success: true };
  } catch (error) {
    return { success: false, stage: 'copy', detail: detailOf(error) };
  }
}

async function copyTree(
  context: IncusVerbContext,
  place: FilePlace,
  dir: string,
  ids: { uid: number; gid: number },
): Promise<void> {
  const entries = (await readdir(dir)).sort();
  for (const entry of entries) {
    const local = join(dir, entry);
    const remote = posix.join(place.path, entry);
    const info = await lstat(local);
    if (info.isDirectory()) {
      if ((await statFile(context.client, place.target, remote)) === undefined)
        await makeDirectory(context.client, place.target, remote, {
          ...ids,
          mode: octal(info.mode),
        });
      await copyTree(context, { ...place, path: remote }, local, ids);
    } else if (info.isFile()) {
      await writeIncusFile(
        context.client,
        place.target,
        remote,
        new Uint8Array(await readFile(local)),
        { ...ids, mode: octal(info.mode) },
      );
    } else {
      throw new Error(
        `${local} is neither a file nor a directory; only those are copied.`,
      );
    }
  }
}

/** A directory entry name Incus answered that is safe to join locally. */
function safeEntry(entry: string): boolean {
  return (
    entry !== '' &&
    entry !== '.' &&
    entry !== '..' &&
    !entry.includes('/') &&
    !entry.includes('\\') &&
    !entry.includes('\0')
  );
}

/**
 * Copy the contents of the directory `source` in the instance into the local
 * `dir`, stopping at `maxBytes` of file content and at `timeoutS`.
 */
export async function copyOutOfInstance(
  context: IncusVerbContext,
  name: string,
  source: string,
  dir: string,
  options: CopyOutOptions,
): Promise<ExecResult> {
  const fail = (stderr: string): ExecResult => ({
    success: false,
    stdout: '',
    stderr,
    exitCode: 1,
  });
  const read = await context.client.getInstance(name);
  if (read === undefined) return fail(`There is no instance ${name}.`);
  const deadline = Date.now() + options.timeoutS * 1000;
  let budget = options.maxBytes;
  const walk = async (place: FilePlace, local: string): Promise<void> => {
    if (Date.now() > deadline)
      throw new Error(
        `The copy of ${source} out of ${name} exceeded its ${options.timeoutS} s.`,
      );
    const listing = await readIncusFile(
      context.client,
      place.target,
      place.path,
      { maxBytes: LISTING_MAX_BYTES },
    );
    if (listing === undefined)
      throw new Error(`${name} has no ${source} to copy.`);
    if (listing.type !== 'directory')
      throw new Error(`${source} in ${name} is not a directory.`);
    await mkdir(local, { recursive: true, mode: 0o700 });
    for (const entry of listing.entries) {
      if (!safeEntry(entry))
        throw new Error(
          `Incus listed an entry ${JSON.stringify(entry)} under ${source}.`,
        );
      if (Date.now() > deadline)
        throw new Error(
          `The copy of ${source} out of ${name} exceeded its ${options.timeoutS} s.`,
        );
      const path = posix.join(place.path, entry);
      const stat = await statFile(context.client, place.target, path);
      if (stat === undefined) continue;
      if (stat.type === 'directory') {
        await walk({ ...place, path }, join(local, entry));
        continue;
      }
      if (stat.type === 'symlink') {
        console.warn(
          `${posix.join(source, posix.relative(place.path, path))} in ${name} is a symlink; it is not copied.`,
        );
        continue;
      }
      let file;
      try {
        file = await readIncusFile(context.client, place.target, path, {
          maxBytes: Math.max(budget, 0),
        });
      } catch (error) {
        if (error instanceof IncusApiError && error.status === 413)
          throw new Error(
            `The copy of ${source} out of ${name} holds more than ${options.maxBytes} bytes.`,
            { cause: error },
          );
        throw error;
      }
      if (file?.type !== 'file') continue;
      budget -= file.content.byteLength;
      if (budget < 0)
        throw new Error(
          `The copy of ${source} out of ${name} holds more than ${options.maxBytes} bytes.`,
        );
      await writeFile(join(local, entry), file.content, { mode: 0o600 });
    }
  };
  try {
    await walk(await placeOf(context, read.instance, source), dir);
    return { success: true, stdout: '', stderr: '', exitCode: 0 };
  } catch (error) {
    return fail(detailOf(error));
  }
}
