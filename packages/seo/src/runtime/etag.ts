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
 * Build a `Response` for `entry`, honouring `If-None-Match` with a 304
 * that carries the same caching headers a 200 would carry (RFC 9110
 * §15.4.5) so intermediaries refresh their stored validators.
 */
export function respondWithEtag(
  request: Request,
  entry: CachedEntry,
): Response {
  if (request.headers.get('if-none-match') === entry.etag) {
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
