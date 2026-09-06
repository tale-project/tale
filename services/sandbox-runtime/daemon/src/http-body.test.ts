// REGRESSION (body-cap contract drift): runnerd used to cap every body at a
// private 4 MiB and answer 400 bad_request over it, while the spawner
// accepted 8 MiB and forwarded the same stage payload — so a batch the
// spawner took was refused daemon-side as "bad JSON". The cap is now the
// shared protocol constant and an oversize body is its own 413 class.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';

import { readJsonBody } from './http-body.ts';
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from './protocol.ts';

const CAP = 1024;
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const body = await readJsonBody(req, CAP);
      res.writeHead(body.ok ? 200 : body.status, {
        'content-type': 'application/json',
      });
      res.end(JSON.stringify(body.ok ? { echo: body.value } : body));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('readJsonBody', () => {
  test('a body over the cap is 413 payload_too_large, not 400', async () => {
    const res = await fetch(base, {
      method: 'POST',
      body: JSON.stringify({ pad: 'x'.repeat(CAP * 2) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      ok: false,
      status: 413,
      error: 'payload_too_large',
    });
  });

  test('a chunked body over the cap (no Content-Length) is 413 too', async () => {
    // No declared length: the cap has to trip on the running total, and the
    // refusal must still reach the client — the stream is paused, not destroyed.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i += 1) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(CAP / 2)));
        }
        controller.close();
      },
    });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: stream,
      duplex: 'half',
    };
    const res = await fetch(base, init);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
  });

  test('malformed JSON under the cap is 400 bad_request', async () => {
    const res = await fetch(base, { method: 'POST', body: '{not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_request' });
  });

  test('a well-formed body under the cap parses', async () => {
    const res = await fetch(base, {
      method: 'POST',
      body: JSON.stringify({ files: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: { files: [] } });
  });

  test('the default cap is the shared protocol constant (8 MiB)', () => {
    expect(RUNNERD_MAX_REQUEST_BODY_BYTES).toBe(8 * 1024 * 1024);
  });
});
