import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatch } from '../handler';
import type { WebDAVCtx, WebDAVRequest, WebDAVResponse } from '../types';

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
  let cachedBytes: Uint8Array | null = null;

  const webdavReq: WebDAVRequest = {
    method: req.method ?? 'GET',
    url,
    pathname: new URL(url).pathname,
    headers,
    body: null,
    async readBytes() {
      if (cachedBytes) return cachedBytes;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      cachedBytes = new Uint8Array(Buffer.concat(chunks));
      return cachedBytes;
    },
    async readText() {
      const bytes = await this.readBytes();
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
  // ReadableStream — the only remaining type per WebDAVResponseBody.
  // Pipe via async iteration rather than Readable.fromWeb to avoid the
  // ArrayBufferLike/ArrayBuffer generic mismatch Node 22+ exposes.
  void pipeStream(out.body, res);
}

async function pipeStream(
  stream: ReadableStream<Uint8Array>,
  res: ServerResponse,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[webdav-node] stream pipe failed', err);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }
}
