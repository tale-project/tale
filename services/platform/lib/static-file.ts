/**
 * A file from disk as an HTTP response, for the web tier's static doors (the
 * built app under `dist/`, the retained bundles of the previous release, an
 * organization's branding images).
 *
 * The web tier used to run on Bun and answered these with `Bun.file`; it runs
 * on Node inside the backend process now, so this is what a `Bun.file`
 * response did, said in Node: the content type from the extension, the
 * length, the body as a stream (a file is never read into memory to be
 * served), and a single byte range when the request asks for one.
 *
 * One thing is new. A file may have precompressed neighbours — `app.js.br`,
 * `app.js.gz`, written by the build next to `app.js` — and a request that
 * accepts one of those encodings gets it as it is. The edge then has nothing
 * to compress, which is where its memory went: an encoder per response,
 * held while the response was open.
 */

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { getMimeType } from 'hono/utils/mime';

/** The content codings a precompressed neighbour may carry, best first, and
 * the suffix each is stored under. */
const PRECOMPRESSED_ENCODINGS = [
  ['br', '.br'],
  ['zstd', '.zst'],
  ['gzip', '.gz'],
] as const;

export interface StaticFileOptions {
  /** Headers of the answer beside the ones the file decides (the type, the
   * length, the range, the coding). */
  headers?: Record<string, string>;
  /** The content type, for a door that pins it from an allowlist instead of
   * taking it from the extension. */
  contentType?: string;
  /** Serve a precompressed neighbour when the request accepts its coding. */
  precompressed?: boolean;
}

interface FileFacts {
  path: string;
  size: number;
}

async function regularFile(path: string): Promise<FileFacts | null> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? { path, size: stats.size } : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' ||
      error.code === 'ENOTDIR' ||
      error.code === 'ENAMETOOLONG')
  );
}

/** The codings a request accepts: the tokens of `Accept-Encoding` that are
 * not refused with `q=0`. */
export function acceptedEncodings(header: string | null): Set<string> {
  const accepted = new Set<string>();
  for (const part of (header ?? '').split(',')) {
    const [token = '', ...parameters] = part.split(';');
    const coding = token.trim().toLowerCase();
    if (coding === '') continue;
    const refused = parameters.some((parameter) =>
      /^\s*q\s*=\s*0(?:\.0{0,3})?\s*$/i.test(parameter),
    );
    if (!refused) accepted.add(coding);
  }
  return accepted;
}

type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/** The single range a `Range` header asks for within `size` bytes: null when
 * there is none to honour (no header, another unit, several ranges), and
 * `unsatisfiable` when it lies outside the file. */
export function byteRange(header: string | null, size: number): ByteRange {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    // A suffix: the last N bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(size - length, 0), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * The file at `path` as a response to `request`, or null when there is no
 * such regular file. The caller has already decided the path is one it may
 * serve; nothing here resolves or guards it.
 */
export async function staticFileResponse(
  path: string,
  request: Request,
  options: StaticFileOptions = {},
): Promise<Response | null> {
  const original = await regularFile(path);
  if (original === null) return null;

  const headers = new Headers(options.headers);
  headers.set(
    'Content-Type',
    options.contentType ?? getMimeType(path) ?? 'application/octet-stream',
  );

  let file = original;
  if (options.precompressed === true) {
    // The answer depends on the request's codings whether or not one is
    // used, so a cache must key on them either way.
    headers.append('Vary', 'Accept-Encoding');
    const accepted = acceptedEncodings(request.headers.get('accept-encoding'));
    for (const [coding, suffix] of PRECOMPRESSED_ENCODINGS) {
      if (!accepted.has(coding)) continue;
      const neighbour = await regularFile(`${path}${suffix}`);
      if (neighbour === null) continue;
      headers.set('Content-Encoding', coding);
      file = neighbour;
      break;
    }
  }

  // A range counts bytes of the representation sent; a precompressed one is
  // sent whole, as an encoder at the edge would have sent it.
  const range =
    file === original
      ? byteRange(request.headers.get('range'), file.size)
      : null;
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${file.size}`);
    headers.delete('Content-Type');
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const length = file.size === 0 ? 0 : end - start + 1;
  headers.set('Content-Length', String(length));
  if (range !== null)
    headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
  const status = range === null ? 200 : 206;

  if (request.method === 'HEAD' || length === 0)
    return new Response(null, { status, headers });
  // The stream reads as the response is written; an aborted response
  // destroys it, which closes the file.
  const body = Readable.toWeb(createReadStream(file.path, { start, end }));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- node's web stream type and the DOM's describe the same stream
  return new Response(body as unknown as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}

/** A text file's content, or null when there is no such file. */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error) || isDirectory(error)) return null;
    throw error;
  }
}

function isDirectory(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EISDIR';
}
