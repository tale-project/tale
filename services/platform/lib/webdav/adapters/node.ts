import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { dispatch } from '../handler';
import {
  WebDAVBodyTooLarge,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';
import { firstForwardedFor } from './headers';

// Methods whose body we STREAM straight through as a Web ReadableStream
// (consumed by the handler, e.g. PUT → Convex storage). Every other
// method that carries a body (LOCK / PROPPATCH / PROPFIND / MKCOL) reads
// it via readBytes/readText, which drains the raw Node `req` stream.
//
// These two paths are mutually exclusive ON PURPOSE: `Readable.toWeb(req)`
// takes ownership of the socket and, across the async dispatch gap before
// a handler calls readText(), pulls the buffered body into the Web
// stream's internal queue — leaving a later `for await (chunk of req)` in
// readBytes with nothing. So we must NOT build a Web stream for the
// buffered methods, or their request body silently arrives empty (this
// manifested as LOCK → 400 "Missing If: header for refresh" and
// PROPPATCH / named-prop PROPFIND silently ignoring their body in dev,
// while prod's fetch adapter — whose Request.body is a lazy stream that is
// never pulled for those methods — worked fine).
const STREAMING_METHODS = new Set(['PUT', 'POST']);

// Vite Connect adapter. Node's http req/res are pre-Fetch-API — we
// adapt to the same WebDAVRequest the Hono adapter delivers, then write
// the response back through Node's stream API.
export async function nodeAdapter(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebDAVCtx,
): Promise<void> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else if (typeof v === 'string') {
      headers.set(k, v);
    }
  }

  // Use a dummy origin — only req.pathname is consumed downstream.
  const url = `http://localhost${req.url ?? '/'}`;
  const method = (req.method ?? 'GET').toUpperCase();
  const isStreaming = STREAMING_METHODS.has(method);

  // Mirror the Web Fetch AbortSignal contract — clients dropping the
  // socket mid-upload must propagate to platform→Convex upstream calls.
  const ac = new AbortController();
  const abort = () => ac.abort();
  req.on('aborted', abort);
  // 'close' on an http.IncomingMessage fires on NORMAL completion too (as soon
  // as the request body is fully received) — not only on client disconnect.
  // An unconditional abort here cancels the in-flight upstream upload of every
  // healthy PUT, returning a spurious 499. `req.complete` is true once the full
  // body has arrived, so only a PREMATURE close (complete === false) is a real
  // disconnect worth propagating.
  req.on('close', () => {
    if (!req.complete) ac.abort();
  });

  // Build the Web stream ONLY for streaming methods (PUT/POST). Buffered
  // methods (LOCK/PROPPATCH/PROPFIND/MKCOL) read their body via readBytes,
  // which drains the raw Node `req` — building a Web stream here too would
  // let it pull the socket empty before readBytes runs (see STREAMING_METHODS).
  let body: ReadableStream<Uint8Array> | null = null;
  if (isStreaming) {
    // Readable.toWeb's generic disagrees with the Web ReadableStream<Uint8Array>
    // we promise in WebDAVRequest: it returns ReadableStream<any> in
    // @types/node 22 while the runtime emits Uint8Array chunks for an
    // IncomingMessage. Cast preserves the contract.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
  }

  let cachedBytes: Uint8Array | null = null;

  const webdavReq: WebDAVRequest = {
    method,
    url,
    pathname: new URL(url).pathname,
    headers,
    body,
    signal: ac.signal,
    // In dev there's no Caddy in front, so fall back to the socket peer.
    clientIp:
      firstForwardedFor(headers.get('x-forwarded-for')) ??
      req.socket?.remoteAddress ??
      undefined,
    async readBytes(maxBytes?: number) {
      if (cachedBytes) return cachedBytes;
      if (typeof maxBytes === 'number') {
        const cl = headers.get('content-length');
        if (cl) {
          const n = Number(cl);
          if (Number.isFinite(n) && n > maxBytes) {
            throw new WebDAVBodyTooLarge(maxBytes);
          }
        }
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        total += b.byteLength;
        if (typeof maxBytes === 'number' && total > maxBytes) {
          throw new WebDAVBodyTooLarge(maxBytes);
        }
        chunks.push(b);
      }
      cachedBytes = new Uint8Array(Buffer.concat(chunks));
      return cachedBytes;
    },
    async readText(maxBytes?: number) {
      const bytes = await this.readBytes(maxBytes);
      return new TextDecoder().decode(bytes);
    },
  };

  let out: WebDAVResponse;
  try {
    out = await dispatch(webdavReq, ctx);
  } catch (err) {
    console.error('[webdav-node] dispatch failed', err);
    res.statusCode = 500;
    res.end('Internal error');
    return;
  }

  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers ?? {})) {
    res.setHeader(k, v);
  }

  if (out.body === null) {
    res.end();
    return;
  }
  if (typeof out.body === 'string') {
    res.end(out.body);
    return;
  }
  if (out.body instanceof Uint8Array) {
    res.end(Buffer.from(out.body));
    return;
  }
  // Blob fallback (Convex storage proxy may return Blob)
  if (out.body instanceof Blob) {
    const buf = Buffer.from(await out.body.arrayBuffer());
    res.end(buf);
    return;
  }
  // ReadableStream. `pipeline` wires up backpressure + error
  // propagation; res.end() fires automatically on completion.
  // Readable.fromWeb's first-arg type uses the Node `ReadableStream`
  // shim which doesn't unify with the Web `ReadableStream` type — cast
  // is intentional here.
  try {
    await pipeline(
      Readable.fromWeb(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        out.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      ),
      res,
    );
  } catch (err) {
    console.error('[webdav-node] stream pipe failed', err);
    if (!res.headersSent) res.statusCode = 500;
    if (!res.writableEnded) res.end();
  }
}
