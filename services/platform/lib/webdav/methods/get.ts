import { anyApi } from 'convex/server';

import { rewriteStorageOrigin } from '../ctx';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';

interface DocumentForResponse {
  _id: string;
  title?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  contentType?: string | null;
  contentHash?: string | null;
  size?: number | null;
  creationTime?: number | null;
  sourceModifiedAt?: number | null;
}

// Wrap in double quotes per RFC 7232 §2.3. Prefer the strong content-hash
// when present; otherwise emit a weak validator derived from size + mtime
// so PROPFIND, GET, HEAD, and Convex GC all converge on the same identity.
// Never falls back to `_id` (immutable) — that would let a stale cache
// satisfy conditional requests after an in-place overwrite.
//
// Returns the COMPLETE validator including quotes / the `W/` weak marker.
// PROPFIND must emit this verbatim (not re-quote it) so DAV:getetag and
// the GET ETag header are byte-identical — hence the narrow param type so
// the propfind handler can reuse it.
export function computeETag(doc: {
  contentHash?: string | null;
  size?: number | null;
  sourceModifiedAt?: number | null;
  creationTime?: number | null;
}): string {
  if (doc.contentHash) return `"${doc.contentHash}"`;
  const size = typeof doc.size === 'number' ? doc.size : 0;
  const mtime = doc.sourceModifiedAt ?? doc.creationTime ?? 0;
  return `W/"${size}-${mtime}"`;
}

function computeLastModified(doc: DocumentForResponse): Date {
  return new Date(doc.sourceModifiedAt ?? doc.creationTime ?? Date.now());
}

// HTTP Last-Modified is second-resolution; truncate before compare so an
// `If-Modified-Since` echo (also second-resolution) matches cleanly.
function lastModifiedSeconds(doc: DocumentForResponse): number {
  return Math.floor(computeLastModified(doc).getTime() / 1000);
}

function inferExtension(doc: DocumentForResponse): string {
  if (doc.extension && doc.extension.length > 0) {
    return doc.extension.startsWith('.') ? doc.extension : `.${doc.extension}`;
  }
  return '';
}

function buildContentDisposition(doc: DocumentForResponse): string {
  const rawTitle = (
    doc.title && doc.title.length > 0 ? doc.title : 'document'
  ).trim();
  // Append extension if the title doesn't already carry one. Lets Safari /
  // Quick Look pick the right preview without guessing from the body.
  const ext = inferExtension(doc);
  const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(rawTitle);
  const filename = hasExt || ext === '' ? rawTitle : `${rawTitle}${ext}`;
  // ASCII fallback for legacy clients: strip non-ASCII and quote-unsafe chars.
  const ascii =
    filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
  const encoded = encodeURIComponent(filename);
  // `attachment`, not `inline`: /dav GET drops CSP (DAV bodies are raw
  // blobs, not HTML), so an uploaded .html served inline would execute as
  // a same-origin document in a browser (stored XSS). Forcing download
  // neutralizes that; nosniff + X-Frame-Options: DENY (set by secureForDav)
  // close the rest. WebDAV clients (Finder, rclone) ignore this header and
  // read the body regardless, so mounted-drive UX is unaffected.
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

interface ParsedRange {
  start: number;
  end: number;
}

// RFC 7233 §2.1: parse a single-range `bytes=` spec. Multi-range (e.g.
// `bytes=0-99,200-299`) is intentionally not supported — clients that ask
// for one get a full 200 back, which is RFC-compliant. Returns `null` for
// unparseable input (caller ignores Range), or `'unsatisfiable'` for
// well-formed-but-out-of-bounds requests (caller returns 416).
// Exported for unit testing (the streamed GET paths are otherwise
// excluded from the connector suite).
export function parseRangeHeader(
  header: string | null,
  size: number,
): ParsedRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;
  if (size <= 0) return 'unsatisfiable';

  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    if (!Number.isFinite(start) || start < 0) return null;
    if (endStr === '') {
      end = size - 1;
    } else {
      end = Number(endStr);
      if (!Number.isFinite(end) || end < start) return null;
      if (end > size - 1) end = size - 1;
    }
  }

  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

function buildResponseHeaders(
  doc: DocumentForResponse,
  opts: { etag: string; lastModified: Date },
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type':
      doc.contentType ?? doc.mimeType ?? 'application/octet-stream',
    ETag: opts.etag,
    'Last-Modified': opts.lastModified.toUTCString(),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': buildContentDisposition(doc),
  };
  if (typeof doc.size === 'number') {
    headers['Content-Length'] = String(doc.size);
  }
  return headers;
}

// RFC 7232 §3.1: `If-None-Match: *` matches any current representation.
// Exported for unit testing — see parseRangeHeader.
export function ifNoneMatchMatches(header: string, etag: string): boolean {
  const trimmed = header.trim();
  if (trimmed === '*') return true;
  // Compare with weak-comparison semantics: strip the optional `W/` prefix
  // from both sides before equality check (RFC 7232 §2.3.2).
  const stripWeak = (s: string) => s.replace(/^W\//, '');
  const target = stripWeak(etag);
  return trimmed.split(',').some((part) => stripWeak(part.trim()) === target);
}

function parseHttpDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// RFC 7233 §3.2: an If-Range value is either an entity-tag or an HTTP-date.
// The Range is honored only if it matches the current representation. ETags
// use strong comparison (a weak validator like our `W/"size-mtime"` must not
// satisfy If-Range — strong comparison fails and we fall back to a full 200,
// which is the safe outcome). Exported for unit testing.
export function ifRangeMatches(
  header: string,
  etag: string,
  lastModified: Date,
): boolean {
  const trimmed = header.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith('W/')) {
    // Strong comparison: both sides must be strong and byte-identical.
    if (trimmed.startsWith('W/') || etag.startsWith('W/')) return false;
    return trimmed === etag;
  }
  const since = Date.parse(trimmed);
  if (!Number.isFinite(since)) return false;
  return Math.floor(lastModified.getTime() / 1000) <= Math.floor(since / 1000);
}

export async function handleGet(
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
  headOnly: boolean,
  req?: WebDAVRequest,
): Promise<WebDAVResponse> {
  const resolved = await ctx.convex.query(
    anyApi.webdav.tree_queries.resolvePath,
    {
      organizationId: auth.organizationId,
      namespace: parsed.namespace,
      segments: parsed.segments,
    },
  );
  if (!resolved.exists) {
    return { status: 404, headers: {}, body: 'Not found' };
  }
  if (resolved.kind !== 'document') {
    // GET on a collection: many WebDAV servers return an HTML listing;
    // we return 405 since the SPA UI is the discoverable surface and
    // /dav/ is not a user-browsable URL.
    return {
      status: 405,
      headers: { Allow: 'OPTIONS, PROPFIND' },
      body: 'GET on a collection is not allowed',
    };
  }

  const doc = await ctx.convex.query(
    anyApi.webdav.tree_queries.getDocumentProps,
    {
      organizationId: auth.organizationId,
      documentId: resolved.documentId,
    },
  );
  if (!doc || !doc.fileId) {
    return { status: 404, headers: {}, body: 'Not found' };
  }

  const etag = computeETag(doc);
  const lastModified = computeLastModified(doc);
  const headers = buildResponseHeaders(doc, { etag, lastModified });

  // Conditional GET (RFC 7232 §6). If-None-Match takes precedence over
  // If-Modified-Since when both are present.
  const ifNoneMatch = req?.headers.get('if-none-match') ?? null;
  const ifModifiedSince = req?.headers.get('if-modified-since') ?? null;
  if (ifNoneMatch) {
    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      return { status: 304, headers, body: null };
    }
  } else {
    const since = parseHttpDate(ifModifiedSince);
    if (since !== null && lastModifiedSeconds(doc) <= since) {
      return { status: 304, headers, body: null };
    }
  }

  if (headOnly) {
    return { status: 200, headers, body: null };
  }

  const size = typeof doc.size === 'number' ? doc.size : 0;
  let rangeHeader = req?.headers.get('range') ?? null;
  // RFC 7233 §3.2: If-Range guards the Range. Only honor the Range when the
  // validator still matches the current representation; otherwise the client's
  // cached partial is stale and we MUST return the full 200, not a 206 of
  // mismatched bytes (which would silently corrupt a resumed download).
  const ifRange = req?.headers.get('if-range') ?? null;
  if (rangeHeader && ifRange && !ifRangeMatches(ifRange, etag, lastModified)) {
    rangeHeader = null;
  }
  const rangeParsed = parseRangeHeader(rangeHeader, size);
  if (rangeParsed === 'unsatisfiable') {
    return {
      status: 416,
      headers: {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes',
      },
      body: 'Range not satisfiable',
    };
  }

  const upstreamHeaders: Record<string, string> = {};
  if (rangeParsed) {
    upstreamHeaders['Range'] = `bytes=${rangeParsed.start}-${rangeParsed.end}`;
  }
  const signal =
    req && 'signal' in req
      ? (req as { signal?: AbortSignal }).signal
      : undefined;

  const fetchBlob = async (
    url: string,
    label: string,
  ): Promise<Response | null> => {
    try {
      const r = await fetch(url, { headers: upstreamHeaders, signal });
      if ((r.ok || r.status === 206) && r.body) return r;
      // Drain so the connection can be reused, then signal failure.
      await r.body?.cancel().catch(() => {});
      console.warn(`[webdav] GET blob fetch (${label}) status ${r.status}`);
      return null;
    } catch (err) {
      console.warn(`[webdav] GET blob fetch (${label}) threw`, err);
      return null;
    }
  };

  // Prefer Convex's native file-serving URL: it streams and supports Range
  // WITHOUT loading the blob into a V8 isolate, so large downloads work.
  // The /storage httpAction (ctx.storage.get) buffers the whole blob in the
  // isolate and caps at its memory limit — keep it only as a fallback for
  // deployments where the direct URL isn't reachable from this process.
  const directUrl: unknown = await ctx.convex
    .query(anyApi.webdav.tree_queries.getWebdavBlobUrl, {
      storageId: doc.fileId,
    })
    .catch((err: unknown) => {
      console.warn('[webdav] GET getWebdavBlobUrl failed', err);
      return null;
    });

  let upstream: Response | null = null;
  if (typeof directUrl === 'string' && directUrl.length > 0) {
    // getUrl() bakes in the backend's self-origin (127.0.0.1:3210 self-hosted),
    // unreachable from this container; re-home onto the reachable backend
    // origin so the fast streaming path works in compose (no :3211 fallback).
    upstream = await fetchBlob(
      rewriteStorageOrigin(directUrl, ctx.convexApiUrl),
      'direct',
    );
  }
  if (!upstream) {
    const proxyUrl = `${ctx.storageBaseUrl}/storage?id=${encodeURIComponent(doc.fileId)}`;
    upstream = await fetchBlob(proxyUrl, 'proxy');
  }
  if (!upstream || !upstream.body) {
    return { status: 502, headers: {}, body: 'Storage fetch failed' };
  }

  if (upstream.status === 206) {
    // Mirror upstream's Content-Range / Content-Length so the client sees
    // the actually-served slice, not the full-resource headers.
    const contentRange = upstream.headers.get('content-range');
    const contentLength = upstream.headers.get('content-length');
    const partialHeaders: Record<string, string> = { ...headers };
    if (contentRange) partialHeaders['Content-Range'] = contentRange;
    if (contentLength) partialHeaders['Content-Length'] = contentLength;
    partialHeaders['Accept-Ranges'] =
      upstream.headers.get('accept-ranges') ?? 'bytes';
    return { status: 206, headers: partialHeaders, body: upstream.body };
  }

  return { status: 200, headers, body: upstream.body };
}
