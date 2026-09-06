// REGRESSION (body-cap contract drift): runnerd used to cap every body at a
// private 4 MiB and answer 400 bad_request over it, while the spawner
// accepted 8 MiB and forwarded the same stage payload — so a batch the
// spawner took was refused daemon-side as "bad JSON". The cap is now the
// shared protocol constant and an oversize body is its own 413 class.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';

import { readJsonBody } from './http-body.ts';
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from './protocol.ts';

const CAP = 1024;
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const body = await readJsonBody(req, CAP);
      const payload = JSON.stringify(body.ok ? { echo: body.value } : body);
      res.writeHead(body.ok ? 200 : body.status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });
      res.end(payload);
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

  // REGRESSION (dirty keep-alive after a refusal): the reader used to answer
  // the 413 as soon as the running total passed the cap, with the tail of
  // the upload still unread on the socket — and the next request on that
  // connection was parsed as body and answered 400 with no JSON at all. Two
  // requests go down ONE socket in a single write here (the tail of the
  // oversize chunked body and the whole second request are already buffered
  // when the cap trips), and the second must still be answered on its own
  // terms — which takes draining the refused body before answering.
  test('a refused body is drained, so a pipelined next request is answered', async () => {
    const chunk = 'x'.repeat(CAP / 2);
    const chunked = Array.from(
      { length: 4 },
      () => `${(CAP / 2).toString(16)}\r\n${chunk}\r\n`,
    ).join('');
    const second = '{not json';
    const wire =
      `POST / HTTP/1.1\r\nHost: h\r\nContent-Type: application/json\r\n` +
      `Transfer-Encoding: chunked\r\n\r\n${chunked}0\r\n\r\n` +
      `POST / HTTP/1.1\r\nHost: h\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${second.length}\r\n\r\n${second}`;
    const url = new URL(base);
    const raw = await new Promise<string>((resolve, reject) => {
      let received = '';
      const socket = connect(Number(url.port), url.hostname, () => {
        socket.write(wire);
      });
      const settle = (): void => {
        socket.destroy();
        resolve(received);
      };
      const deadline = setTimeout(settle, 3000);
      socket.setEncoding('utf8');
      socket.on('data', (data: string) => {
        received += data;
        // Both responses are Content-Length framed and end in `}`.
        if (
          (received.match(/HTTP\/1\.1 /g) ?? []).length === 2 &&
          received.endsWith('}')
        ) {
          clearTimeout(deadline);
          settle();
        }
      });
      socket.on('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      socket.on('close', () => {
        clearTimeout(deadline);
        resolve(received);
      });
    });
    const responses = raw
      .split(/(?=HTTP\/1\.1 )/)
      .filter((part) => part.length > 0)
      .map((part) => ({
        status: Number(part.slice(9, 12)),
        body: part.slice(part.indexOf('\r\n\r\n') + 4),
      }));
    expect(responses.map((r) => r.status)).toEqual([413, 400]);
    expect(JSON.parse(responses[0]?.body ?? 'null')).toMatchObject({
      error: 'payload_too_large',
    });
    expect(JSON.parse(responses[1]?.body ?? 'null')).toMatchObject({
      error: 'bad_request',
    });
  });

  test('the default cap is the shared protocol constant (8 MiB)', () => {
    expect(RUNNERD_MAX_REQUEST_BODY_BYTES).toBe(8 * 1024 * 1024);
  });
});
