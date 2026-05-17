/**
 * Precompiled artifact server — reads `manifest.json` + emitted files
 * from disk and serves them with the same `ArtifactsServer` interface
 * the on-demand server exposes.
 *
 * No source files are touched at request time, so this is the only mode
 * that's safe inside a Docker runtime image where the original markdown
 * source tree was not copied. The manifest is read synchronously at boot
 * (one round-trip); file bodies are read lazily on first request and
 * cached forever.
 *
 * Output is byte-identical to the on-demand server: same builders feed
 * both modes, and ETags are precomputed with the same sha256 hash, so a
 * client can switch transparently between dev and prod.
 */

import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { isMdPathname } from '../builders/md-paths';
import { type CachedEntry, respondWithEtag } from './etag';
import {
  MANIFEST_FILE,
  type Manifest,
  type ManifestEntry,
  readManifest,
} from './manifest';
import type { ArtifactsServer } from './on-demand-server';

export interface PrecompiledServerParams {
  /** Absolute path to the directory `manifest.json` lives in. */
  dir: string;
}

export async function createPrecompiledServer(
  params: PrecompiledServerParams,
): Promise<ArtifactsServer> {
  const { dir } = params;
  const manifest: Manifest = await readManifest(dir);
  return createPrecompiledServerFromManifest({ dir, manifest });
}

interface FromManifestParams {
  dir: string;
  manifest: Manifest;
}

/**
 * Build a server from an already-loaded manifest — kept exported so
 * tests can construct a server without writing to disk.
 */
export function createPrecompiledServerFromManifest(
  params: FromManifestParams,
): ArtifactsServer {
  const { dir, manifest } = params;
  const resolvedDir = resolve(dir);

  const byPath = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) byPath.set(entry.path, entry);
  const knownMd = new Set<string>(manifest.knownMdPaths);

  const cache = new Map<string, CachedEntry>();

  function load(entry: ManifestEntry): CachedEntry | null {
    const hit = cache.get(entry.path);
    if (hit) return hit;

    // Defence-in-depth: resolve the candidate against the artifact
    // root and confirm it stays inside before any disk access. A
    // malicious / corrupted manifest cannot make us read files
    // outside `dir` (e.g. `entry.file = "../../etc/passwd"`).
    const resolvedFile = resolve(resolvedDir, entry.file);
    const rel = relative(resolvedDir, resolvedFile);
    if (rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith('..')) {
      console.error(
        `[seo] manifest entry ${entry.file} escapes artifact dir ${resolvedDir}; refusing to read.`,
      );
      return null;
    }

    let body: string;
    try {
      body = readFileSync(resolvedFile, 'utf-8');
    } catch (error) {
      // A manifest entry without an on-disk file indicates a broken
      // build (someone shipped manifest.json without the artifact). We
      // log so it shows up in container logs and return null so the
      // request falls through to a 404 instead of crashing.
      console.error(
        `[seo] precompiled artifact ${entry.file} missing from ${resolvedDir}:`,
        error,
      );
      return null;
    }
    const cached: CachedEntry = {
      body,
      etag: entry.etag,
      contentType: entry.contentType,
      cacheControl: entry.cacheControl,
    };
    cache.set(entry.path, cached);
    return cached;
  }

  return {
    async handle(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      const entry = byPath.get(pathname);
      if (entry) {
        const cached = load(entry);
        return cached ? respondWithEtag(request, cached) : null;
      }

      // Unknown `.md` pathnames short-circuit immediately: if the
      // precompile didn't enumerate it, the runtime cannot.
      if (isMdPathname(pathname) && !knownMd.has(pathname)) return null;

      return null;
    },
    invalidate() {
      cache.clear();
    },
  };
}

export { MANIFEST_FILE };
