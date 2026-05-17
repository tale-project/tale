/**
 * ETag helpers shared by the on-demand server and the precompile path.
 *
 * Identical content always produces an identical ETag — this is the
 * stability contract that lets a `Response` from `createPrecompiledServer`
 * be byte-for-byte interchangeable with one from `createOnDemandServer`
 * when both render the same artifact.
 */

import { createHash } from 'node:crypto';

/** Strong validator: quoted lowercase hex prefix of `sha256(content)`. */
export function etagOf(content: string): string {
  return `"${createHash('sha256').update(content).digest('hex').slice(0, 16)}"`;
}

export interface CachedEntry {
  body: string;
  etag: string;
  contentType: string;
  cacheControl: string;
}

/**
 * Normalise a single ETag literal for weak comparison (RFC 9110
 * §8.8.3.2): strip an optional `W/` prefix and surrounding double
 * quotes so `W/"abc"`, `"abc"`, and `abc` all compare equal.
 */
function normaliseEtag(raw: string): string {
  let v = raw.trim();
  if (v.startsWith('W/')) v = v.slice(2);
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

/**
 * Parse an `If-None-Match` header and decide whether `storedEtag`
 * matches per RFC 9110 §13.1.2:
 *
 *   - `*` matches any current representation
 *   - a comma-separated list matches if any member matches
 *   - weak validators (`W/"…"`) compare equal to strong ones, because
 *     §13.1.2 mandates *weak* comparison for `If-None-Match`
 */
export function matchesIfNoneMatch(
  ifNoneMatch: string | null,
  storedEtag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  const target = normaliseEtag(storedEtag);
  return trimmed.split(',').some((piece) => normaliseEtag(piece) === target);
}

/**
 * Build a `Response` for `entry`, honouring `If-None-Match` with a 304
 * that carries the same caching headers a 200 would carry (RFC 9110
 * §15.4.5) so intermediaries refresh their stored validators.
 */
export function respondWithEtag(
  request: Request,
  entry: CachedEntry,
): Response {
  if (matchesIfNoneMatch(request.headers.get('if-none-match'), entry.etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: entry.etag,
        'cache-control': entry.cacheControl,
      },
    });
  }
  return new Response(entry.body, {
    headers: {
      'content-type': entry.contentType,
      etag: entry.etag,
      'cache-control': entry.cacheControl,
    },
  });
}
