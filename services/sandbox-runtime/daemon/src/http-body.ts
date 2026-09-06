// Request-body intake for runnerd's JSON routes: one bounded read, one
// contract for what a rejected body looks like. The cap is the wire
// protocol's RUNNERD_MAX_REQUEST_BODY_BYTES (the spawner clamps its own cap
// to it), and an oversize body answers 413 payload_too_large — a distinct
// class from a malformed one (400 bad_request), so a caller that hits the
// cap learns that, not "your JSON is broken".

import type { IncomingMessage } from 'node:http';

import { RUNNERD_MAX_REQUEST_BODY_BYTES } from './protocol.ts';

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400; error: 'bad_request' }
  | { ok: false; status: 413; error: 'payload_too_large' };

type BodyRead = { kind: 'read'; raw: string } | { kind: 'too_large' };

/**
 * Collect the request body up to `maxBytes` WITHOUT ever destroying the
 * request stream. Refusing from inside a `for await` (throw/break) calls the
 * iterator's `return()`, which destroys the IncomingMessage: on Node that
 * aborts the socket, and under Bun's node:http the 413 the route writes
 * afterwards is lost and the client reads a 200 — so the body is taken off
 * the `data` event, an oversize body is refused by pausing the stream (a
 * declared oversize `Content-Length` before the first byte, a running total
 * past the cap otherwise), and the route's 413 goes out on a live socket
 * that `Connection: close` then closes with the unread remainder.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.pause();
      resolve({ kind: 'too_large' });
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: BodyRead): void => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      resolve(result);
    };
    const onData = (chunk: unknown): void => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : Buffer.from(String(chunk), 'utf8');
      total += buf.length;
      if (total > maxBytes) {
        req.pause();
        finish({ kind: 'too_large' });
        return;
      }
      chunks.push(buf);
    };
    req.on('data', onData);
    req.once('end', () => {
      finish({ kind: 'read', raw: Buffer.concat(chunks).toString('utf8') });
    });
    req.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      reject(error);
    });
  });
}

/** Read and JSON-parse a request body under `maxBytes`. Never throws: the
 * caller sends `status`/`error` verbatim on `ok: false`. */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = RUNNERD_MAX_REQUEST_BODY_BYTES,
): Promise<JsonBodyResult> {
  let read: BodyRead;
  try {
    read = await readBody(req, maxBytes);
  } catch {
    return { ok: false, status: 400, error: 'bad_request' };
  }
  if (read.kind === 'too_large') {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }
  try {
    return { ok: true, value: JSON.parse(read.raw) };
  } catch {
    return { ok: false, status: 400, error: 'bad_request' };
  }
}
