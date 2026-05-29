import { dispatch } from '../handler';
import type { WebDAVCtx, WebDAVRequest, WebDAVResponse } from '../types';

// Hono adapter. Hono delivers a standard Web Fetch Request and expects
// a standard Web Fetch Response back. The dispatch layer is framework-
// neutral so this adapter is the only Hono-specific glue.
export async function fetchAdapter(
  req: Request,
  ctx: WebDAVCtx,
): Promise<Response> {
  const url = new URL(req.url);

  let cachedBytes: Uint8Array | null = null;
  const webdavReq: WebDAVRequest = {
    method: req.method,
    url: req.url,
    pathname: url.pathname,
    headers: req.headers,
    body: req.body,
    async readBytes() {
      if (cachedBytes) return cachedBytes;
      const buf = await req.arrayBuffer();
      cachedBytes = new Uint8Array(buf);
      return cachedBytes;
    },
    async readText() {
      const bytes = await this.readBytes();
      return new TextDecoder().decode(bytes);
    },
  };

  const out = await dispatch(webdavReq, ctx);
  return toFetchResponse(out);
}

function toFetchResponse(out: WebDAVResponse): Response {
  const init = { status: out.status, headers: out.headers };
  if (out.body === null) return new Response(null, init);
  if (typeof out.body === 'string') return new Response(out.body, init);
  if (out.body instanceof Blob) return new Response(out.body, init);
  if (out.body instanceof Uint8Array) {
    // Re-wrap in a fresh ArrayBuffer-backed view — readBytes() upstream
    // returns Uint8Array<ArrayBufferLike> which TS won't pass to
    // BodyInit under strict types.
    const buf = new ArrayBuffer(out.body.byteLength);
    new Uint8Array(buf).set(out.body);
    return new Response(buf, init);
  }
  // ReadableStream — the only remaining type per WebDAVResponseBody.
  return new Response(out.body, init);
}
