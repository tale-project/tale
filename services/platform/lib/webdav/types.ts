import type { ConvexHttpClient } from 'convex/browser';

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
  // Where to read the body as text/bytes when the handler needs it.
  // Stays lazy so GET/PROPFIND with no body don't allocate.
  readText: () => Promise<string>;
  readBytes: () => Promise<Uint8Array>;
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

// Shared ctx threaded into every dispatch — built once at server start.
export interface WebDAVCtx {
  convex: ConvexHttpClient;
  // Public base URL used to materialize blob fetch URLs for GET (we
  // proxy through Convex /storage). Falls back to convex client's URL.
  storageBaseUrl: string;
  // Token used to call /storage from the platform server (same as the
  // Convex deployment URL — bearer auth not required for /storage since
  // the storageId itself is hard to guess).
}

export interface ParsedPath {
  orgSlug: string;
  namespace: 'documents' | '.trash';
  segments: string[];
  isCollection: boolean;
}
