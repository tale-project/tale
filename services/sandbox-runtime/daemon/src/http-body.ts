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
 * Collect the request body up to `maxBytes`, reading the stream TO ITS END
 * whatever the verdict. Refusing from inside a `for await` (throw/break)
 * calls the iterator's `return()`, which destroys the IncomingMessage: on
 * Node that aborts the socket, and under Bun's node:http the 413 the route
 * writes afterwards is lost and the client reads a 200. Answering early on a
 * live socket is no better: a response that ends with request bytes still
 * unread leaves the connection in a state the two sides disagree on — the
 * next request on it is parsed as body and answered 400 with no JSON at
 * all (this module's own suite flaked that way on Bun 1.3.12), and closing
 * the socket instead hangs Bun 1.3.12's fetch (the spawner's runtime) on
 * its next call. So an oversize body — a declared oversize `Content-Length`,
 * or a running total past the cap — is DRAINED: everything past the cap is
 * dropped unbuffered (memory stays bounded by `maxBytes`), and the 413 is
 * answered once the upload has ended, on a clean keep-alive connection.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > maxBytes;
    req.on('data', (chunk: unknown) => {
      if (tooLarge) return;
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : Buffer.from(String(chunk), 'utf8');
      total += buf.length;
      if (total > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buf);
    });
    req.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(
        tooLarge
          ? { kind: 'too_large' }
          : { kind: 'read', raw: Buffer.concat(chunks).toString('utf8') },
      );
    });
    req.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
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
