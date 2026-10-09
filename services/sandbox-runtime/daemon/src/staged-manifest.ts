// What runnerd staged into the workspace, kept across its restarts. Every
// staged item names its immutable source (`sourceId`) and the sha256 of its
// bytes; a later stage of the same source reuses the file when its bytes still
// hash to that digest. The manifest used to live in memory alone, so after
// every idle stop the next turn fetched every URL item again (task attachments,
// the newest deliverables, automation folder mounts), and each warm hit
// re-read every staged byte to hash it.
//
// It is now written to the workspace, beside the files it describes, with the
// stat tuple of each file at the moment its hash was last verified: device,
// inode, size and nanosecond mtime and ctime. A file whose tuple is unchanged
// still holds the verified bytes, since nothing the session's uid can do sets
// a ctime back; any write, rename into place or metadata change moves it. A
// tuple is only ever taken from a verified hash, never after a download, and
// only once its ctime is a few seconds old: kernel timestamps can be coarser
// than the time a write takes, the same reason git treats a file as "racily
// clean" when it changed in the second the index was written.
//
// The file is the agent's to write like the rest of the workspace, so it is
// signed with runnerd's token (HMAC-SHA256): one that does not verify — edited,
// truncated, from another session or an older format — is not used, and the
// stage falls back to fetching and hashing as before.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** A staged file's identity when its hash was last verified, as decimal
 * strings: bigint stats do not survive JSON as numbers. */
export interface StagedStat {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}

/** What one staged path holds: the source it came from, the sha256 of its
 * bytes and, once a hash of the file in place verified them, its stat. */
export interface StagedSource {
  sourceId: string;
  digest: string;
  stat?: StagedStat;
}

const FORMAT = 'tale-staged-sources-v1';

/** A manifest larger than this is not read: at its entry cap it stays near
 * one megabyte. */
export const STAGED_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

const DIGEST_RE = /^[0-9a-f]{64}$/;
const DECIMAL_RE = /^\d{1,40}$/;
const SOURCE_ID_MAX = 1024;

type Entry =
  | [string, string, string]
  | [string, string, string, string, string, string, string, string];

function signature(key: string, entries: string): Buffer {
  return createHmac('sha256', key).update(`${FORMAT}\n${entries}`).digest();
}

/** The manifest as the bytes to write, keyed by workspace-relative path. */
export function encodeStagedManifest(
  sources: Iterable<[string, StagedSource]>,
  key: string,
): string {
  const entries: Entry[] = [];
  for (const [path, source] of sources) {
    const { stat } = source;
    entries.push(
      stat === undefined
        ? [path, source.sourceId, source.digest]
        : [
            path,
            source.sourceId,
            source.digest,
            stat.dev,
            stat.ino,
            stat.size,
            stat.mtimeNs,
            stat.ctimeNs,
          ],
    );
  }
  const body = JSON.stringify(entries);
  return JSON.stringify({
    format: FORMAT,
    entries,
    mac: signature(key, body).toString('hex'),
  });
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((part) => typeof part === 'string')
  );
}

/**
 * The manifest `text` holds, keyed by workspace-relative path, or null when
 * it is not one this runnerd wrote: not JSON, another format, a signature
 * that does not verify under `key`, or an entry out of shape. `accept` says
 * whether a path may be staged at all; an entry it refuses is dropped.
 */
export function decodeStagedManifest(
  text: string,
  key: string,
  accept: (path: string) => boolean,
): Map<string, StagedSource> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn('[runnerd] the staged-files manifest is not JSON:', error);
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('format' in parsed) ||
    parsed.format !== FORMAT ||
    !('entries' in parsed) ||
    !Array.isArray(parsed.entries) ||
    !('mac' in parsed) ||
    typeof parsed.mac !== 'string' ||
    !/^[0-9a-f]{64}$/.test(parsed.mac)
  )
    return null;
  const entries: unknown[] = parsed.entries;
  const expected = signature(key, JSON.stringify(entries));
  if (!timingSafeEqual(expected, Buffer.from(parsed.mac, 'hex'))) return null;
  const sources = new Map<string, StagedSource>();
  for (const entry of entries) {
    if (!isStringArray(entry) || (entry.length !== 3 && entry.length !== 8))
      return null;
    const [path, sourceId, digest, dev, ino, size, mtimeNs, ctimeNs] = entry;
    if (
      path === undefined ||
      sourceId === undefined ||
      digest === undefined ||
      sourceId.length === 0 ||
      sourceId.length > SOURCE_ID_MAX ||
      !DIGEST_RE.test(digest)
    )
      return null;
    const stat =
      dev !== undefined &&
      ino !== undefined &&
      size !== undefined &&
      mtimeNs !== undefined &&
      ctimeNs !== undefined
        ? { dev, ino, size, mtimeNs, ctimeNs }
        : undefined;
    if (
      stat !== undefined &&
      !Object.values(stat).every((value) => DECIMAL_RE.test(value))
    )
      return null;
    if (!accept(path)) continue;
    sources.set(path, {
      sourceId,
      digest,
      ...(stat === undefined ? {} : { stat }),
    });
  }
  return sources;
}
