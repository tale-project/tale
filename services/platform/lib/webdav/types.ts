export type WebDAVMethod =
  | 'OPTIONS'
  | 'PROPFIND'
  | 'PROPPATCH'
  | 'GET'
  | 'HEAD'
  | 'PUT'
  | 'DELETE'
  | 'MKCOL'
  | 'MOVE'
  | 'COPY'
  | 'LOCK'
  | 'UNLOCK';

export const WEBDAV_METHODS: ReadonlyArray<WebDAVMethod> = [
  'OPTIONS',
  'PROPFIND',
  'PROPPATCH',
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'MKCOL',
  'MOVE',
  'COPY',
  'LOCK',
  'UNLOCK',
];

// XML bodies (PROPFIND/PROPPATCH/LOCK/MKCOL) cap. Anything larger is
// almost certainly an attack — RFC 4918 envisions tiny XML envelopes.
export const WEBDAV_MAX_XML_BODY = 64 * 1024;

// PUT body cap. Operators can raise via WEBDAV_MAX_PUT_BYTES env var.
// Default 5 GB matches the Caddyfile request_body cap.
export const WEBDAV_MAX_PUT_BYTES = (() => {
  const raw = process.env.WEBDAV_MAX_PUT_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : 5 * 1024 * 1024 * 1024;
})();

// Authorization header cap — anything longer is junk; reject before
// touching `atob`. 4 KB matches Caddy's default header cap.
export const WEBDAV_MAX_AUTH_HEADER = 4 * 1024;

// Framework-neutral request shape. Adapters (Hono / Vite Connect) build
// one of these from their native request type, then call dispatch().
export interface WebDAVRequest {
  // Open string — adapters pass through whatever the underlying HTTP
  // layer parsed. dispatch() narrows to WebDAVMethod via WEBDAV_METHODS
  // membership check.
  method: string;
  url: string;
  pathname: string;
  headers: Headers;
  // Body is a readable stream for large PUTs and a string for parseable
  // XML bodies. Adapters decide which based on the method.
  body: ReadableStream<Uint8Array> | null;
  // Aborts when the client disconnects. Handlers forward to upstream
  // `fetch` calls so a cancelled PUT or GET stops bandwidth burn end
  // to end.
  signal?: AbortSignal;
  // Client IP (first hop of X-Forwarded-For, set by Caddy on /dav/*; the
  // socket peer in dev). Used to key the failed-auth rate limiter so one
  // attacker IP can't lock a victim org out. Undefined when unavailable
  // (auth falls back to a shared 'unknown' bucket).
  clientIp?: string;
  // Where to read the body as text/bytes when the handler needs it.
  // Stays lazy so GET/PROPFIND with no body don't allocate. `maxBytes`
  // bounds the buffered size — exceeded reads throw so the dispatcher
  // can map to 413.
  readText: (maxBytes?: number) => Promise<string>;
  readBytes: (maxBytes?: number) => Promise<Uint8Array>;
}

// readBytes / readText throws this when Content-Length or the actual
// streamed size exceeds the caller-supplied cap. Handlers catch and
// return 413.
export class WebDAVBodyTooLarge extends Error {
  constructor(public readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'WebDAVBodyTooLarge';
  }
}

export interface WebDAVResponseInit {
  status: number;
  headers?: Record<string, string>;
}

export type WebDAVResponseBody =
  | string
  | Uint8Array
  | ReadableStream<Uint8Array>
  | Blob
  | null;

export interface WebDAVResponse extends WebDAVResponseInit {
  body: WebDAVResponseBody;
}

// Per-request resolved auth context. Built by dispatch() after Basic
// auth + org membership check; passed to every method handler.
export interface AuthContext {
  userId: string;
  organizationId: string;
  orgSlug: string;
  appPasswordId: string;
}

/**
 * How this layer reaches the handlers behind it: three name-addressed calls
 * and nothing else. The 0.5 door (`backend/domains/webdav/routes.ts`) passes
 * a shim over its own PG handler map; the tests pass a stub. Neither is a
 * client of anything — the protocol layer only ever names a function and
 * hands it arguments.
 *
 * Responses are `any`, which is what the retired client's generic resolved to
 * for a name-addressed call, so this replacement changes nothing about how
 * strictly they are read. Tightening it is worth doing and is NOT free: 66
 * call sites read these results structurally, and the handler stubs in the
 * tests return partial shapes that a declared union would reject — so the
 * shapes and the stubs have to land together, as their own change.
 */
export interface WebDAVBackend {
  // oxlint-disable-next-line typescript/no-explicit-any -- see above: the untyped seam, unchanged
  query(reference: unknown, args?: Record<string, unknown>): Promise<any>;
  // oxlint-disable-next-line typescript/no-explicit-any -- see above
  mutation(reference: unknown, args?: Record<string, unknown>): Promise<any>;
  // oxlint-disable-next-line typescript/no-explicit-any -- see above
  action(reference: unknown, args?: Record<string, unknown>): Promise<any>;
}

// Shared ctx threaded into every dispatch — built once at server start.
export interface WebDAVCtx {
  backend: WebDAVBackend;
}

export interface ParsedPath {
  orgSlug: string;
  namespace: 'documents' | '.trash';
  segments: string[];
  isCollection: boolean;
}
