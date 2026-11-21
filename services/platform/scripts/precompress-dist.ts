/**
 * Write the built app's precompressed neighbours: `app.js.br` and `app.js.gz`
 * beside `app.js`, for every file of `dist/` worth compressing.
 *
 * The web tier answers a request that accepts one of those codings with the
 * neighbour as it is (`lib/static-file.ts`), so the edge in front of it has
 * nothing left to compress. That is where the edge's memory went while a
 * page loaded: an encoder per open response, a megabyte or more each for
 * the app's larger chunks, and a first visit opens dozens at once. Done
 * here, once per build, the work also buys the smallest answer there is:
 * brotli at its highest quality, which no server can afford per request.
 *
 * Two codings, and no third. Every browser that sends `zstd` sends `br` as
 * well, and brotli at quality 11 is the smaller of the two for text, so a
 * `.zst` neighbour would be bytes in the image that no request picks. Gzip
 * is for whatever asks for nothing newer.
 *
 * What is left out:
 * - files that are compressed already (images, `woff`, `woff2`), and source
 *   maps, which a browser fetches only with its developer tools open and the
 *   edge may compress then;
 * - HTML: the page a browser gets is rendered from `index.html` per request
 *   and `offline.html` is rewritten, so the files themselves are asked for
 *   by next to nobody, and the edge compresses the answer that is;
 * - `openapi.json`, for the same reason: the web tier answers it with the
 *   deployment's own origin written in;
 * - a file under a kilobyte, which a coding's own framing would not shrink
 *   by enough to matter;
 * - a neighbour that would not be smaller than its file.
 *
 * Runs after everything that writes into `dist/` (the Vite build, the
 * boot shell), and before nothing that reads it: the service worker's
 * manifest and the entry budget were computed from the files themselves.
 * The output is a function of the input alone (no timestamp reaches the
 * gzip header), so a build stays reproducible.
 *
 * Usage (from `services/platform`): `bun scripts/precompress-dist.ts [dist]`
 */

import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

/** The extensions worth a neighbour: text, and fonts that are not packed. */
export const COMPRESSIBLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js',
  '.mjs',
  '.css',
  '.svg',
  '.json',
  '.webmanifest',
  '.txt',
  '.xml',
  '.ttf',
  '.otf',
  '.wasm',
]);

/** Below this a neighbour is not written. */
export const MIN_BYTES = 1024;

/**
 * Files of `dist/` the web tier never sends from disk as they are, whatever
 * their extension, by their path under `dist/`: a route of `server.ts`
 * answers each before the one that serves files, so a neighbour would be
 * bytes in the image that no request reaches.
 */
export const ANSWERED_PER_REQUEST: ReadonlySet<string> = new Set([
  'openapi.json',
]);

/** The codings written, and the suffix `lib/static-file.ts` looks for. */
export const CODINGS = [
  { coding: 'br', suffix: '.br' },
  { coding: 'gzip', suffix: '.gz' },
] as const;

const SUFFIXES: readonly string[] = CODINGS.map(({ suffix }) => suffix);

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** One file's bytes in a coding, at the highest setting it has. */
export async function encode(
  bytes: Buffer,
  coding: (typeof CODINGS)[number]['coding'],
): Promise<Buffer> {
  if (coding === 'br')
    return brotli(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    });
  return gzipped(bytes, { level: constants.Z_BEST_COMPRESSION });
}

/** Whether a file of this path under `dist/` and this size gets neighbours. */
export function isCompressible(name: string, size: number): boolean {
  return (
    size >= MIN_BYTES &&
    COMPRESSIBLE_EXTENSIONS.has(extname(name).toLowerCase()) &&
    !ANSWERED_PER_REQUEST.has(name.replaceAll('\\', '/'))
  );
}

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

export interface PrecompressSummary {
  /** Files that got at least one neighbour. */
  files: number;
  /** Their bytes, and the bytes of their neighbours per coding. */
  bytes: number;
  encoded: Record<(typeof CODINGS)[number]['coding'], number>;
  /** Neighbours left by an earlier run and removed because their file no
   *  longer gets one. */
  removed: number;
}

/**
 * Bring the neighbours of every file under `dist` to what this run would
 * write: present and current where a file gets one, absent where it gets
 * none. A neighbour whose file was rebuilt is rewritten, never trusted, and
 * one whose file gets none now is removed: either would be served as that
 * file, with the bytes of an earlier build.
 *
 * A `.br` or `.gz` with no file to be the neighbour of is left alone. Nothing
 * can be answered with it but a request for its own name, and it may be a
 * file the app ships that way.
 */
export async function precompressDist(
  dist: string,
  concurrency = Math.max(1, availableParallelism()),
): Promise<PrecompressSummary> {
  const all = await filesUnder(dist);
  const sources = all.filter(
    (path) => !SUFFIXES.some((suffix) => path.endsWith(suffix)),
  );
  const present = new Set(sources);
  const summary: PrecompressSummary = {
    files: 0,
    bytes: 0,
    encoded: { br: 0, gzip: 0 },
    removed: 0,
  };
  const wanted = new Set<string>();

  let next = 0;
  const work = async (): Promise<void> => {
    for (;;) {
      const path = sources[next];
      next += 1;
      if (path === undefined) return;
      const bytes = await readFile(path);
      if (!isCompressible(relative(dist, path), bytes.length)) continue;
      let written = false;
      for (const { coding, suffix } of CODINGS) {
        const encoded = await encode(bytes, coding);
        if (encoded.length >= bytes.length) continue;
        await writeFile(`${path}${suffix}`, encoded);
        wanted.add(`${path}${suffix}`);
        summary.encoded[coding] += encoded.length;
        written = true;
      }
      if (written) {
        summary.files += 1;
        summary.bytes += bytes.length;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, work),
  );

  for (const path of all) {
    const suffix = SUFFIXES.find((candidate) => path.endsWith(candidate));
    if (
      suffix === undefined ||
      wanted.has(path) ||
      !present.has(path.slice(0, -suffix.length))
    )
      continue;
    await rm(path);
    summary.removed += 1;
  }
  return summary;
}

if (import.meta.main) {
  const dist = resolve(process.argv[2] ?? 'dist');
  const started = performance.now();
  const summary = await precompressDist(dist);
  const megabytes = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);
  const share = (bytes: number) =>
    summary.bytes === 0 ? '0' : ((bytes / summary.bytes) * 100).toFixed(0);
  console.log(
    `precompress-dist: ${summary.files} files of ${relative(process.cwd(), dist) || '.'}, ${megabytes(summary.bytes)} MB → ` +
      `${megabytes(summary.encoded.br)} MB br (${share(summary.encoded.br)}%), ` +
      `${megabytes(summary.encoded.gzip)} MB gzip (${share(summary.encoded.gzip)}%)` +
      (summary.removed > 0 ? `, ${summary.removed} stale removed` : '') +
      ` in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  if (summary.files === 0) {
    console.error(
      `precompress-dist: nothing under ${dist} to compress. Run it after the build.`,
    );
    process.exit(1);
  }
}
