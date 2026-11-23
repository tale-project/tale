// @vitest-environment node

import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';

import { appErrorHandler } from '../error-reporting.ts';
import {
  APP_BODY_MAX_BYTES,
  appBodyLimit,
  appJsonBody,
  BODY_TOO_LARGE_MESSAGE,
} from './app-json-body.ts';

/**
 * The app door read a JSON body of any size. Its routes' limits are
 * checked by their schemas, once the body has been read and parsed, so a
 * signed-in member could have the process hold hundreds of megabytes,
 * three times over, for a request no route would accept
 * (tale-project/tale#4942). The door now refuses a body over 16 MiB before
 * it is read, and leaves the one door that takes a file to that door's own
 * limit.
 */

/** What reached a handler: how many bytes of body it read. */
function app(): Hono {
  const hono = new Hono();
  hono.onError(appErrorHandler);
  hono.use(requestId());
  hono.use('/api/app/*', appBodyLimit());
  hono.use('/api/app/*', appJsonBody());
  hono.post('/api/app/tasks/:id/move', async (c) => {
    const body = await c.req.json<{ note: string }>();
    return c.json({ read: body.note.length });
  });
  hono.post('/api/app/files/upload', async (c) => {
    let read = 0;
    if (c.req.raw.body !== null) {
      for await (const chunk of c.req.raw.body) read += chunk.byteLength;
    }
    return c.json({ read });
  });
  return hono;
}

/**
 * A body of `bytes` in 64 KiB pieces, saying how much of it was asked for.
 * It ends: a door that read all of it would fail its test, where a body
 * without an end would have the test read until the machine had no memory.
 */
function bodyOf(bytes: number) {
  let pulled = 0;
  const piece = new Uint8Array(64 * 1024).fill(0x20);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= bytes) {
        controller.close();
        return;
      }
      pulled += piece.byteLength;
      controller.enqueue(piece);
    },
  });
  return { body, pulled: () => pulled };
}

const post = (
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) =>
  app().request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime asks for the option with a stream body; the typings do not know it
    ...({ duplex: 'half' } as unknown as RequestInit),
  });

describe('appBodyLimit', () => {
  it('refuses a body that declares more than the limit, before a byte of it is read', async () => {
    const source = bodyOf(APP_BODY_MAX_BYTES * 4);

    const res = await post('/api/app/tasks/t1/move', source.body, {
      'content-length': String(APP_BODY_MAX_BYTES + 1),
      'x-request-id': 'req-large',
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: BODY_TOO_LARGE_MESSAGE,
      code: 'BODY_TOO_LARGE',
      requestId: 'req-large',
    });
    expect(BODY_TOO_LARGE_MESSAGE).toBe(
      'The request body exceeds the 16 MiB limit',
    );
    // Only what a stream queues ahead of any reader.
    expect(source.pulled()).toBeLessThanOrEqual(2 * 64 * 1024);
  });

  it('cuts a body that declares nothing at the limit', async () => {
    const source = bodyOf(APP_BODY_MAX_BYTES * 4);

    const res = await post('/api/app/tasks/t1/move', source.body);

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'BODY_TOO_LARGE' });
    // It stopped asking soon after the limit, with three quarters unread.
    expect(source.pulled()).toBeLessThan(APP_BODY_MAX_BYTES * 2);
  });

  it('lets a body of exactly the limit through to its route', async () => {
    const note = 'x'.repeat(APP_BODY_MAX_BYTES - '{"note":""}'.length);
    const body = `{"note":"${note}"}`;

    const res = await post('/api/app/tasks/t1/move', body, {
      'content-length': String(body.length),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ read: note.length });
  });

  it('leaves the door that takes a file to its own limit', async () => {
    const bytes = APP_BODY_MAX_BYTES + 64 * 1024;

    const res = await post('/api/app/files/upload', bodyOf(bytes).body, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ read: bytes });
  });
});
