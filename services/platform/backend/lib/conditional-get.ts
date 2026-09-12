import { createHash } from 'node:crypto';

import type { Env, MiddlewareHandler } from 'hono';

/**
 * Validated reads for the JSON doors — the half of HTTP caching a poller
 * needs. Every `200` JSON answer to a `GET` or `HEAD` leaves here with an
 * `ETag` over its bytes, a request that presents that tag in
 * `If-None-Match` is answered `304` with no body, and `Cache-Control`
 * says `private, no-cache`: no shared cache may keep the answer, the
 * client's own cache must revalidate before reusing it — which is what
 * lets a browser send the conditional request on its own and a machine
 * client keep the body it will be told is still current.
 *
 * Before this, nothing on either surface could be revalidated: `/api/v1`
 * answered `no-store` on all 79 responses an audit captured, `/api/app`
 * answered no cache directive at all, and neither carried a validator —
 * so five polls of a finished run moved five identical bodies, and 500
 * open chat tabs re-downloaded unchanged lists on every refetch.
 *
 * A route that computes its own `ETag` (a blob's content hash) keeps it —
 * the comparison here is the one place the `304` is decided. Nothing but
 * JSON is touched: an event stream, a download, a redirect and every
 * error pass through untouched, as does anything a route chose a
 * directive for — except the bare `no-store` a door stamps on every
 * answer by default, which the mount names in `replaceDoorDefault`.
 */

/** The directive of a validated read: kept only by the client's own cache,
 * and revalidated before every reuse. */
export const VALIDATED_READ_CACHE_CONTROL = 'private, no-cache';

/** What a `304` never carries: the body's framing (RFC 9110 §15.4.5). */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding'];

/** A strong entity tag over the representation's bytes: the first 128 bits
 * of its SHA-256, base64url — 22 characters, quoted. */
export function entityTagOf(bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest();
  return `"${digest.subarray(0, 16).toString('base64url')}"`;
}

/** The content codings the edge may append to a tag it compressed
 * (`"abc"` → `"abc-gzip"`): the codings Caddy's `encode` can serve. */
const EDGE_CODING_SUFFIX = /-(?:gzip|zstd|br|deflate)"$/;

/**
 * The opaque tag inside an entity tag as this origin issued it: the weak
 * marker stripped — the weak comparison of RFC 9110 §13.1.2, the one
 * `If-None-Match` uses — and the edge's coding suffix removed. Caddy's
 * `encode` rewrites the tag of every answer it compresses to `"abc-gzip"`
 * (or `-zstd`), and strips that suffix from a single incoming tag only
 * when the request offers the same coding; a client that stored the
 * suffixed form and revalidates with a tag list, or without that coding,
 * would otherwise never be told 304. The suffixed tag names the same
 * bytes before encoding, which is what the client holds after decoding.
 */
export function canonicalEntityTag(tag: string): string {
  const trimmed = tag.trim();
  const opaque = trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
  return opaque.replace(EDGE_CODING_SUFFIX, '"');
}

/**
 * Whether an `If-None-Match` field matches `etag`: `*` matches any current
 * representation, otherwise any member of the list matches under weak
 * comparison, edge coding suffix included.
 */
export function ifNoneMatchMatches(header: string, etag: string): boolean {
  if (header.trim() === '*') return true;
  const wanted = canonicalEntityTag(etag);
  return header
    .split(',')
    .map(canonicalEntityTag)
    .some((tag) => tag !== '' && tag === wanted);
}

export interface ConditionalGetOptions {
  /**
   * A `Cache-Control` value the door stamps on every answer by default —
   * replaced by the validated-read directive on the answers that got a
   * validator here. A route's own choice of any other value is kept.
   */
  replaceDoorDefault?: string;
}

/**
 * The middleware: runs after the route, on `GET`/`HEAD` answers that are
 * `200` and JSON. HEAD reaches here with the body a GET would have had —
 * the framework drops it after the pipeline — so a HEAD carries the same
 * validator and length as its GET.
 */
export function conditionalGet<E extends Env>(
  options: ConditionalGetOptions = {},
): MiddlewareHandler<E> {
  return async (c, next) => {
    await next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return;
    if (c.res.status !== 200) return;
    const type = (c.res.headers.get('content-type') ?? '').toLowerCase();
    if (!type.startsWith('application/json')) return;
    // A download is a blob lane's answer, whatever the stored type says —
    // its store issued the validator and compared it; never buffer it.
    if (c.res.headers.has('content-disposition')) return;

    let etag = c.res.headers.get('etag');
    if (etag === null) {
      if (c.res.body === null) return;
      // The answer was built as one string; reading it back is a copy, and
      // the bytes are what the tag must cover.
      const bytes = new Uint8Array(await c.res.arrayBuffer());
      etag = entityTagOf(bytes);
      c.res = new Response(bytes, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: c.res.headers,
      });
      c.res.headers.set('etag', etag);
      c.res.headers.set('content-length', String(bytes.byteLength));
    }
    const directive = c.res.headers.get('cache-control');
    if (
      directive === null ||
      (options.replaceDoorDefault !== undefined &&
        directive === options.replaceDoorDefault)
    ) {
      c.res.headers.set('cache-control', VALIDATED_READ_CACHE_CONTROL);
    }

    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch === undefined || !ifNoneMatchMatches(ifNoneMatch, etag)) {
      return;
    }
    // The client already holds these bytes. The framework copies the 200's
    // headers onto the replacement, so the validator, the directive, the
    // request id and the transport headers ride along; only the body's
    // framing is removed.
    c.res = new Response(null, { status: 304 });
    for (const name of BODY_HEADERS) c.res.headers.delete(name);
  };
}
