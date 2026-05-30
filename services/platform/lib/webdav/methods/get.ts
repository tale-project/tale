import { anyApi } from 'convex/server';

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
export function computeETag(doc: DocumentForResponse): string {
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
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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
function parseRangeHeader(
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
function ifNoneMatchMatches(header: string, etag: string): boolean {
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
  const rangeHeader = req?.headers.get('range') ?? null;
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

  // Proxy stream the blob through Convex `/storage`. Going through the
  // existing route (not direct ctx.storage.get — we're outside Convex)
  // means we inherit its sanitation + rate limiting.
  const blobUrl = `${ctx.storageBaseUrl}/storage?id=${encodeURIComponent(doc.fileId)}`;
  const upstreamHeaders: Record<string, string> = {};
  if (rangeParsed) {
    upstreamHeaders['Range'] = `bytes=${rangeParsed.start}-${rangeParsed.end}`;
  }
  const upstream = await fetch(blobUrl, {
    headers: upstreamHeaders,
    // Forward client aborts to Convex so a cancelled download doesn't
    // keep streaming bytes platform-side.
    signal:
      req && 'signal' in req
        ? (req as { signal?: AbortSignal }).signal
        : undefined,
  });
  if (!upstream.ok && upstream.status !== 206) {
    console.warn('[webdav] GET storage proxy failed', upstream.status);
    return { status: 502, headers: {}, body: 'Storage fetch failed' };
  }
  if (!upstream.body) {
    console.warn('[webdav] GET storage proxy returned empty body');
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
