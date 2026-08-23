import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OBJECT_STORAGE_CONFIG_DOMAIN,
  OBJECT_STORAGE_CONNECTION_KEY,
} from './shared/schemas/object_storage';

/**
 * Origins the browser must be allowed to reach for per-org bring-your-own
 * object storage (`<TALE_CONFIG_DIR>/<orgSlug>/object-storage/connection.json`).
 *
 * With an org bucket configured, `files/blob_actions.generateBlobUpload` hands
 * the browser a presigned PUT addressed at the org's EXTERNAL endpoint, and the
 * `/storage` httpAction 302-redirects document GETs to presigned URLs on that
 * same endpoint — so the SPA's CSP (`connect-src` for fetch/XHR, `img-src` /
 * `media-src` for redirected media loads) must include those origins or the
 * browser kills the transfer before it leaves the page. The rest of the CSP
 * stays strict; see the policy comment in `server.ts`.
 *
 * Extraction is deliberately LOOSE (no schema validation): the authoritative
 * validation happens in Convex at write time, and a platform container running
 * one release behind the config writer must still emit the origin rather than
 * strict-parse-fail into a broken upload. Unreadable or malformed files are
 * skipped with a warning — never thrown.
 */

interface OriginExtractionInput {
  endpoint?: unknown;
  bucket?: unknown;
  region?: unknown;
}

/** True iff `err` is a Node ErrnoException with the given code. */
function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

/**
 * Derive the browser-facing origin(s) for one org's connection file content.
 * With an explicit endpoint (MinIO/R2/Wasabi) the origin is the endpoint's.
 * Without one (AWS S3 proper) the presigned URL lands on the regional AWS
 * host — virtual-hosted (`<bucket>.s3.<region>.amazonaws.com`) by default,
 * path-style (`s3.<region>.amazonaws.com`) under `forcePathStyle` — so both
 * are returned rather than mirroring the SDK's style choice here.
 */
export function originsForConnection(conn: OriginExtractionInput): string[] {
  if (typeof conn.endpoint === 'string' && conn.endpoint.length > 0) {
    try {
      return [new URL(conn.endpoint).origin];
    } catch (err) {
      console.warn(
        '[org-storage-origins] unparsable endpoint URL; skipping',
        { endpoint: conn.endpoint },
        err,
      );
      return [];
    }
  }
  if (typeof conn.bucket === 'string' && typeof conn.region === 'string') {
    // These two values are interpolated into a response HEADER — restrict
    // them to the S3 bucket-name / region alphabets so a hostile config
    // value (a `;`, whitespace, `*`) can never smuggle extra CSP sources
    // or directives. The endpoint branch above is immune (URL.origin).
    if (
      !/^[a-z0-9.-]{3,63}$/.test(conn.bucket) ||
      !/^[a-z0-9-]{1,32}$/.test(conn.region)
    ) {
      console.warn(
        '[org-storage-origins] bucket/region outside the S3 alphabet; skipping',
        { bucket: conn.bucket, region: conn.region },
      );
      return [];
    }
    return [
      `https://${conn.bucket}.s3.${conn.region}.amazonaws.com`,
      `https://s3.${conn.region}.amazonaws.com`,
    ];
  }
  return [];
}

/**
 * Scan every org's `object-storage/connection.json` under `configDir` and
 * return the deduplicated, sorted set of storage origins. Missing files and
 * unreadable JSON are skipped (warned, never thrown) — a broken org config
 * must not take the security headers down with it.
 */
export function collectOrgObjectStorageOrigins(configDir: string): string[] {
  const origins = new Set<string>();
  let entries;
  try {
    entries = readdirSync(configDir, { withFileTypes: true });
  } catch (err) {
    console.warn(
      `[org-storage-origins] cannot read config dir ${configDir}`,
      err,
    );
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(
      configDir,
      entry.name,
      OBJECT_STORAGE_CONFIG_DOMAIN,
      `${OBJECT_STORAGE_CONNECTION_KEY}.json`,
    );
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      // Almost every org has no object-storage config — only warn on
      // anything other than the file simply not existing.
      if (!isErrnoCode(err, 'ENOENT')) {
        console.warn(`[org-storage-origins] cannot read ${file}`, err);
      }
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[org-storage-origins] invalid JSON in ${file}`, err);
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    for (const origin of originsForConnection(parsed)) {
      origins.add(origin);
    }
  }
  return [...origins].sort();
}

/**
 * TTL-cached provider around `collectOrgObjectStorageOrigins`, called on every
 * response by the security-header middleware. The scan is a handful of file
 * reads, but per-response would still be wasteful — and org storage configs
 * change rarely (an admin saving the data-residency panel). A short TTL keeps
 * the window between "panel saved" and "CSP carries the new origin" small
 * without wiring into the config watcher (whose lifecycle is gated by the
 * optional TALE_FILE_EVENTS flag, which security headers must not depend on).
 *
 * A `null`/absent config dir (e.g. unit tests, split deployments without the
 * mount) yields a provider that always returns `[]`.
 */
export function createOrgObjectStorageOriginsProvider(
  configDir: string | null | undefined,
  ttlMs = 5000,
): () => readonly string[] {
  if (!configDir) return () => [];
  let cached: readonly string[] = [];
  let lastScanAt = -Infinity;
  return () => {
    const now = Date.now();
    if (now - lastScanAt >= ttlMs) {
      cached = collectOrgObjectStorageOrigins(configDir);
      lastScanAt = now;
    }
    return cached;
  };
}
