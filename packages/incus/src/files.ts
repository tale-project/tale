// The file APIs: an instance's files (`/1.0/instances/<name>/files`, running
// or not) and a custom volume's files (`file_storage_volume`,
// `/1.0/storage-pools/<pool>/volumes/custom/<volume>/files`, attached or
// not). Both take the owner and mode as `X-Incus-*` headers and answer them
// the same way on a read.
//
// Two facts measured on Incus 7.6 shape this module:
// - Every write sends `Content-Type: application/octet-stream`. With a form
//   content type Incus answers 200 and writes an EMPTY file.
// - The volume file API has no rename. A caller that must replace a file a
//   reader may be reading writes the new content under a new name and
//   deletes the old one after; there is deliberately no rename helper.

import { IncusApiError } from './api.ts';
import type { IncusClient, IncusReply } from './client.ts';

/** Where a path lives: inside an instance, or on a custom volume. */
export type IncusFileTarget =
  | { instance: string }
  | { pool: string; volume: string };

export interface IncusFileOwner {
  uid: number;
  gid: number;
  /** Octal permission bits, `0600`. */
  mode: string;
}

export interface IncusFileStat extends IncusFileOwner {
  type: 'file' | 'directory' | 'symlink';
}

export type IncusFileEntry =
  | (IncusFileOwner & { type: 'file'; content: Uint8Array })
  | (IncusFileOwner & { type: 'directory'; entries: string[] })
  | (IncusFileOwner & { type: 'symlink'; target: string });

/** The largest file read by default (the client's own cap still applies). */
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;

function filesPath(target: IncusFileTarget): string {
  return 'instance' in target
    ? `/1.0/instances/${encodeURIComponent(target.instance)}/files`
    : `/1.0/storage-pools/${encodeURIComponent(target.pool)}/volumes/custom/${encodeURIComponent(target.volume)}/files`;
}

/** An absolute path with no `..` segment and no NUL. Incus refuses an
 * escape itself (a 404); refusing it here keeps the intent visible. */
export function checkFilePath(path: string): string {
  if (
    !path.startsWith('/') ||
    path.includes('\0') ||
    path.split('/').includes('..')
  ) {
    throw new Error(`Not an absolute file path: ${JSON.stringify(path)}`);
  }
  return path;
}

function ownerHeaders(owner: IncusFileOwner): Record<string, string> {
  if (!Number.isSafeInteger(owner.uid) || owner.uid < 0) {
    throw new Error(`Not a uid: ${owner.uid}`);
  }
  if (!Number.isSafeInteger(owner.gid) || owner.gid < 0) {
    throw new Error(`Not a gid: ${owner.gid}`);
  }
  if (!/^0?[0-7]{3,4}$/.test(owner.mode)) {
    throw new Error(`Not an octal mode: ${JSON.stringify(owner.mode)}`);
  }
  return {
    'x-incus-uid': String(owner.uid),
    'x-incus-gid': String(owner.gid),
    'x-incus-mode': owner.mode,
  };
}

function statOf(reply: IncusReply, path: string): IncusFileStat {
  const type = reply.headers.get('x-incus-type') ?? '';
  if (type !== 'file' && type !== 'directory' && type !== 'symlink') {
    throw new IncusApiError(
      `Incus answered a read of ${path} with an unknown file type ${JSON.stringify(type)}`,
      502,
    );
  }
  const number = (name: string) => {
    const value = Number(reply.headers.get(name) ?? 'x');
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new IncusApiError(
        `Incus answered a read of ${path} without a valid ${name}`,
        502,
      );
    }
    return value;
  };
  const mode = reply.headers.get('x-incus-mode') ?? '';
  return {
    type,
    uid: number('x-incus-uid'),
    gid: number('x-incus-gid'),
    mode: /^[0-7]+$/.test(mode) ? mode.padStart(4, '0') : mode,
  };
}

function notFound(error: unknown): boolean {
  return error instanceof IncusApiError && error.status === 404;
}

/** Reads a file, a directory's entry names or a symlink's target (Incus
 * returns a symlink's target, it does not follow it); undefined when the
 * path does not exist. A file over `maxBytes` throws (413). */
export async function readFile(
  client: IncusClient,
  target: IncusFileTarget,
  path: string,
  options: { maxBytes?: number } = {},
): Promise<IncusFileEntry | undefined> {
  let reply: IncusReply;
  try {
    reply = await client.send('GET', filesPath(target), {
      query: { project: client.project, path: checkFilePath(path) },
      retry: true,
      maxResponseBytes: options.maxBytes ?? DEFAULT_MAX_FILE_BYTES,
    });
  } catch (error) {
    if (notFound(error)) return undefined;
    throw error;
  }
  const stat = statOf(reply, path);
  if (stat.type === 'file')
    return { ...stat, type: 'file', content: reply.body };
  if (stat.type === 'symlink') {
    return {
      ...stat,
      type: 'symlink',
      target: new TextDecoder().decode(reply.body),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(reply.body));
  } catch (error) {
    throw new IncusApiError(
      `Incus answered a directory read of ${path} with something that is not JSON`,
      502,
      { cause: error },
    );
  }
  const metadata =
    parsed !== null && typeof parsed === 'object' && 'metadata' in parsed
      ? parsed.metadata
      : undefined;
  if (!Array.isArray(metadata)) {
    throw new IncusApiError(
      `Incus answered a directory read of ${path} without its entries`,
      502,
    );
  }
  return {
    ...stat,
    type: 'directory',
    entries: metadata
      .filter((item): item is string => typeof item === 'string')
      .sort(),
  };
}

/**
 * Reads `length` bytes of a file from `offset` (an HTTP `Range` request,
 * which Incus 7.6 answers 206 with a `Content-Range`), and the file's whole
 * size; a large file is read in pieces this way instead of in one bounded
 * reply. Undefined when the path does not exist.
 */
export async function readFileRange(
  client: IncusClient,
  target: IncusFileTarget,
  path: string,
  offset: number,
  length: number,
): Promise<{ bytes: Uint8Array; size: number } | undefined> {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error(`Not a file offset: ${offset}`);
  if (!Number.isSafeInteger(length) || length < 1)
    throw new Error(`Not a read length: ${length}`);
  let reply: IncusReply;
  try {
    reply = await client.send('GET', filesPath(target), {
      query: { project: client.project, path: checkFilePath(path) },
      headers: { range: `bytes=${offset}-${offset + length - 1}` },
      retry: true,
      maxResponseBytes: length,
    });
  } catch (error) {
    if (notFound(error)) return undefined;
    // A range past the end of the file is no error: it read nothing.
    if (error instanceof IncusApiError && error.status === 416)
      return { bytes: new Uint8Array(), size: offset };
    throw error;
  }
  if (statOf(reply, path).type !== 'file')
    throw new IncusApiError(`${path} is not a file`, 400);
  if (reply.status === 206) {
    const range = /^bytes \d+-\d+\/(\d+)$/.exec(
      reply.headers.get('content-range') ?? '',
    );
    if (range === null)
      throw new IncusApiError(
        `Incus answered a range read of ${path} without a Content-Range`,
        502,
      );
    return { bytes: reply.body, size: Number(range[1]) };
  }
  // A server that ignores the range sends the whole file: only a file no
  // larger than one piece fits the reply's cap at all.
  if (offset !== 0)
    throw new IncusApiError(
      `Incus answered a range read of ${path} with the whole file`,
      502,
    );
  return { bytes: reply.body, size: reply.body.byteLength };
}

/** The type, owner and mode of a path; undefined when it does not exist. */
export async function statFile(
  client: IncusClient,
  target: IncusFileTarget,
  path: string,
): Promise<IncusFileStat | undefined> {
  try {
    const reply = await client.send('HEAD', filesPath(target), {
      query: { project: client.project, path: checkFilePath(path) },
      retry: true,
    });
    return statOf(reply, path);
  } catch (error) {
    if (notFound(error)) return undefined;
    throw error;
  }
}

/** Writes a file with its owner and mode (`overwrite` by default, or
 * `append`). The bytes go as `application/octet-stream`. */
export async function writeFile(
  client: IncusClient,
  target: IncusFileTarget,
  path: string,
  content: string | Uint8Array,
  options: IncusFileOwner & { write?: 'overwrite' | 'append' },
): Promise<void> {
  const raw =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;
  await client.sync('POST', filesPath(target), {
    query: { project: client.project, path: checkFilePath(path) },
    raw,
    headers: {
      'x-incus-type': 'file',
      'x-incus-write': options.write ?? 'overwrite',
      ...ownerHeaders(options),
    },
  });
}

/** Makes a directory with its owner and mode; one that exists is kept. */
export async function makeDirectory(
  client: IncusClient,
  target: IncusFileTarget,
  path: string,
  options: IncusFileOwner,
): Promise<void> {
  await client.sync('POST', filesPath(target), {
    query: { project: client.project, path: checkFilePath(path) },
    raw: new Uint8Array(),
    headers: { 'x-incus-type': 'directory', ...ownerHeaders(options) },
  });
}

/** Deletes a file or an empty directory; false when there was none. */
export async function deleteFile(
  client: IncusClient,
  target: IncusFileTarget,
  path: string,
): Promise<boolean> {
  try {
    await client.sync('DELETE', filesPath(target), {
      query: { project: client.project, path: checkFilePath(path) },
    });
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}
