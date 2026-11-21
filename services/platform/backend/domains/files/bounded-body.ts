import { open } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import { describeByteCap } from '../../lib/byte-cap.ts';
import { newJobDir, removeJobDir } from '../../lib/heavy-slot/job-dir.ts';
import { fileBody, ObjectLengthMismatchError } from '../../lib/object-store.ts';
import { FileError, MAX_UPLOAD_BYTES, putOrgBlobStream } from './service.ts';

/**
 * Bounded intake of an incoming byte stream — the guard every lane that
 * lands a caller- or vendor-supplied body into org storage reads through.
 *
 * Two gates, in order: the DECLARED length (`Content-Length`) is refused
 * before a single byte is read, and the ACTUAL bytes are counted as they
 * arrive and the read aborts the moment they pass the cap. The blob store's
 * own size check still runs afterwards, but it used to be the only one — a
 * multi-gigabyte download (or a chunked body with no declared length) was
 * buffered whole in the worker's heap before it could fire.
 *
 * Two readers stand behind the gates. {@link storeBodyBounded} lands a body
 * in the store as it arrives, for a lane that only passes the bytes on: an
 * upload, an import. Nothing of the body is held, whatever its size.
 * {@link readBodyBounded} answers the bytes, for a lane that looks at them
 * and whose cap is a few megabytes.
 */

export { MAX_UPLOAD_BYTES };

/** The declared body length, when the peer sent a usable one. */
export function declaredContentLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The cap is named the way the reference documents it (`30 MiB`, never
 * `30 MB`): the same unit the REST door's 413 speaks. */
function tooLarge(maxBytes: number, declared: number | null): FileError {
  const cap = describeByteCap(maxBytes);
  return new FileError(
    'FILE_SIZE_INVALID',
    declared === null
      ? `The file exceeds the ${cap} limit`
      : `The file is ${declared} bytes; the limit is ${cap}`,
    413,
  );
}

/** A body with nothing in it is no file: the refusal the store's own size
 * check has always answered. */
function empty(): FileError {
  return new FileError('FILE_SIZE_INVALID', 'Invalid blob size');
}

/** What a sender that stopped is told: a browser that went away, a vendor's
 * connection that dropped. Nothing was stored. */
function stoppedArriving(declared: number | null): FileError {
  return new FileError(
    'FILE_SIZE_INVALID',
    declared === null
      ? 'The file stopped arriving before it was whole'
      : `The file stopped arriving before the ${declared} bytes it declared`,
  );
}

/** Give an unread body back, so its socket is not left waiting. */
async function cancelUnread(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  await body?.cancel().catch((error: unknown) => {
    console.warn('[files] cancelling an unread body failed:', error);
  });
}

/**
 * Read a body into memory, refusing past `maxBytes`: first on the declared
 * length (nothing is read), then on the bytes actually received (the read
 * is cancelled at the first chunk past the cap, so at most one chunk beyond
 * the limit is ever held). Answers the bytes and the length the peer
 * declared, if any.
 */
export async function readBodyBounded(
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = declaredContentLength(source.headers);
  if (declared !== null && declared > maxBytes) {
    // Refused unread: cancel the stream so the socket goes back too.
    await source.body?.cancel().catch((error: unknown) => {
      console.warn('[files] cancelling an oversized body failed:', error);
    });
    throw tooLarge(maxBytes, declared);
  }
  if (source.body === null) return new Uint8Array(0);
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch((error: unknown) => {
          console.warn('[files] cancelling an oversized body failed:', error);
        });
        throw tooLarge(maxBytes, null);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 1 && chunks[0] !== undefined) return chunks[0];
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** A body that has been landed in the organization's store. */
export interface StoredBody {
  /** The blob reference (`s3:<key>`). */
  storageRef: string;
  /** How many bytes were stored. */
  size: number;
}

export interface StoreBodyOptions {
  /** The most bytes the lane accepts. */
  maxBytes: number;
  contentType: string;
  /** Ends the transfer when the sender is gone: a request's own signal, so
   * a browser that went away frees the store's connection too. */
  signal?: AbortSignal;
  /**
   * Looks at the whole body before it is stored, as a file on disk. What it
   * throws refuses the body, and nothing is stored. A body that is looked
   * at goes to disk first, whatever it declared.
   */
  inspect?: (file: { path: string; size: number }) => Promise<void>;
}

/**
 * Land a body in the organization's store without ever holding it, refusing
 * past `maxBytes` (tale-project/tale#4942). The body used to be read whole
 * and then handed to the store, which held an upload of 512 MiB two and a
 * half times over in the process that serves the application.
 *
 * A store takes a body only with its length, so there are two ways in:
 *
 *  - a body that declares its length goes straight from its sender to the
 *    store, a chunk at a time;
 *  - a body that declares none (a chunked request, a vendor's export), one
 *    whose declared length is that of an encoding the transport undoes on
 *    the way (`Content-Encoding`), and one the lane looks at first
 *    ({@link StoreBodyOptions.inspect}) is written to a file of this
 *    process's own, counted as it arrives, and stored from there. The file
 *    is on the container's disk and gone when the call ends.
 *
 * Refusals are a person's to read: past the cap (413, before a byte is read
 * where the length is declared), empty, or ended before it was whole. A
 * store that does not take the body is `OBJECT_STORE_UNAVAILABLE` (503),
 * its own words kept for the log.
 */
export async function storeBodyBounded(
  sql: Sql,
  organizationId: string,
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  opts: StoreBodyOptions,
): Promise<StoredBody> {
  const declared = declaredContentLength(source.headers);
  if (declared !== null && declared > opts.maxBytes) {
    await cancelUnread(source.body);
    throw tooLarge(opts.maxBytes, declared);
  }
  if (opts.inspect === undefined) {
    if (source.body === null || declared === 0) {
      await cancelUnread(source.body);
      throw empty();
    }
    // What a body declares is its own length only where nothing decodes it
    // on the way: `fetch` hands out a compressed response decoded, beside
    // the length it had compressed.
    if (declared !== null && !source.headers.has('content-encoding')) {
      return {
        storageRef: await land(
          sql,
          organizationId,
          source.body,
          declared,
          opts,
        ),
        size: declared,
      };
    }
  }

  const dir = await newJobDir();
  try {
    const filePath = path.join(dir, 'body');
    // A lane that looks at its bodies is shown an empty one too, and says
    // in its own words what it makes of it; the store's door refuses what
    // passes as no file.
    const size = await writeBounded(
      source.body ?? nothing(),
      filePath,
      opts.maxBytes,
    );
    await opts.inspect?.({ path: filePath, size });
    return {
      storageRef: await land(
        sql,
        organizationId,
        fileBody(filePath),
        size,
        opts,
      ),
      size,
    };
  } finally {
    await removeJobDir(dir);
  }
}

/** A body with no bytes in it. */
function nothing(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

/** Write a body to a new file, counting it, and say how long it was. One
 * byte past `maxBytes` ends the read with the lane's 413. */
async function writeBounded(
  body: ReadableStream<Uint8Array>,
  filePath: string,
  maxBytes: number,
): Promise<number> {
  // `wx`: a path that exists is somebody else's file, never overwritten.
  const file = await open(filePath, 'wx', 0o600);
  const reader = body.getReader();
  /** Whether the body may still hold bytes nobody has read. */
  let unread = true;
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read().catch((error: unknown) => {
        // The sender's failure, told apart from the disk's below.
        unread = false;
        console.warn('[files] a body stopped arriving:', error);
        throw stoppedArriving(null);
      });
      if (next.done) {
        unread = false;
        return size;
      }
      size += next.value.byteLength;
      if (size > maxBytes) throw tooLarge(maxBytes, null);
      // The whole chunk, from where the last one ended.
      await file.writeFile(next.value);
    }
  } finally {
    // A body that was refused, or whose file could not be written, is ended
    // here, so its socket goes back too.
    if (unread) {
      await reader.cancel().catch((error: unknown) => {
        console.warn('[files] cancelling a refused body failed:', error);
      });
    }
    await file.close();
  }
}

/** Hand a body of a known length to the store, and put what went wrong in
 * the words of this door. */
async function land(
  sql: Sql,
  organizationId: string,
  body: ReadableStream<Uint8Array>,
  contentLength: number,
  opts: StoreBodyOptions,
): Promise<string> {
  const sender = { failed: false };
  try {
    return await putOrgBlobStream(sql, organizationId, watched(body, sender), {
      contentLength,
      contentType: opts.contentType,
      ...(opts.signal !== undefined && { signal: opts.signal }),
    });
  } catch (error) {
    if (error instanceof FileError) throw error;
    if (
      sender.failed ||
      opts.signal?.aborted === true ||
      (error instanceof ObjectLengthMismatchError && error.found === 'fewer')
    ) {
      throw stoppedArriving(contentLength);
    }
    if (error instanceof ObjectLengthMismatchError) {
      throw new FileError(
        'FILE_SIZE_INVALID',
        `The file went on past the ${contentLength} bytes it declared`,
      );
    }
    console.error('[files] the object store did not take a file:', error);
    throw new FileError(
      'OBJECT_STORE_UNAVAILABLE',
      `The object store did not take the file: ${error instanceof Error ? error.message : String(error)}`,
      503,
    );
  }
}

/** The body as it is, noting on `sender` when it is the body that failed:
 * what tells a sender that stopped from a store that would not listen. */
function watched(
  body: ReadableStream<Uint8Array>,
  sender: { failed: boolean },
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(sink) {
      try {
        const next = await reader.read().catch((error: unknown) => {
          sender.failed = true;
          throw error;
        });
        if (next.done) sink.close();
        else sink.enqueue(next.value);
      } catch (error) {
        sink.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
