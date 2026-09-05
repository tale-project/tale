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

class PayloadTooLarge extends Error {
  constructor() {
    super('payload_too_large');
    this.name = 'PayloadTooLarge';
  }
}

async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    // req yields Buffer chunks; the stream iterator types them as `any`, so
    // Buffer.from accepts it without an assertion.
    const buf = Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) throw new PayloadTooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Read and JSON-parse a request body under `maxBytes`. Never throws: the
 * caller sends `status`/`error` verbatim on `ok: false`. */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = RUNNERD_MAX_REQUEST_BODY_BYTES,
): Promise<JsonBodyResult> {
  let raw: string;
  try {
    raw = await readBody(req, maxBytes);
  } catch (err) {
    if (err instanceof PayloadTooLarge) {
      return { ok: false, status: 413, error: 'payload_too_large' };
    }
    return { ok: false, status: 400, error: 'bad_request' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: 'bad_request' };
  }
}
