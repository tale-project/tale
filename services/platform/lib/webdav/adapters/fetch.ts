import { dispatch } from '../handler';
import {
  WebDAVBodyTooLarge,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';
import { firstForwardedFor } from './headers';

// Hono adapter. Hono delivers a standard Web Fetch Request and expects
// a standard Web Fetch Response back. The dispatch layer is framework-
// neutral so this adapter is the only Hono-specific glue.
export async function fetchAdapter(
  req: Request,
  ctx: WebDAVCtx,
): Promise<Response> {
  const url = new URL(req.url);

  // Body is streamed straight through for PUT. For XML methods we
  // still buffer (via readBytes/readText below) so the size cap fires
  // before parsing. No cache — large PUTs would otherwise sit in RAM.
  const webdavReq: WebDAVRequest = {
    method: req.method,
    url: req.url,
    pathname: url.pathname,
    headers: req.headers,
    body: req.body,
    signal: req.signal,
    clientIp: firstForwardedFor(req.headers.get('x-forwarded-for')),
    async readBytes(maxBytes?: number) {
      return readBodyWithCap(req, maxBytes);
    },
    async readText(maxBytes?: number) {
      const bytes = await readBodyWithCap(req, maxBytes);
      return new TextDecoder().decode(bytes);
    },
  };

  const out = await dispatch(webdavReq, ctx);
  return toFetchResponse(out);
}

async function readBodyWithCap(
  req: Request,
  maxBytes: number | undefined,
): Promise<Uint8Array> {
  if (typeof maxBytes === 'number') {
    const cl = req.headers.get('content-length');
    if (cl) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > maxBytes) {
        throw new WebDAVBodyTooLarge(maxBytes);
      }
    }
  }
  const buf = await req.arrayBuffer();
  if (typeof maxBytes === 'number' && buf.byteLength > maxBytes) {
    throw new WebDAVBodyTooLarge(maxBytes);
  }
  return new Uint8Array(buf);
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
