// @vitest-environment node

import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { appErrorHandler } from '../error-reporting.ts';
import { appJsonBody, INVALID_JSON_MESSAGE } from './app-json-body.ts';

/**
 * The app door's bare `await c.req.json()` — about 127 handlers — answered
 * an empty or truncated body with a SyntaxError 500 the error handler
 * reported as a defect. The reader turns the parse failure, and only the
 * parse failure, into the door's 400 `INVALID_JSON`.
 */

const moveSchema = z.object({ status: z.string() });

function app(): Hono {
  const hono = new Hono();
  hono.onError(appErrorHandler);
  hono.use(requestId());
  hono.use('/api/app/*', appJsonBody());
  // The shape of the bare handlers (`backend/domains/tasks/routes.ts`).
  hono.post('/api/app/tasks/:id/move', async (c) => {
    const body = moveSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    return c.json({ ok: true, status: body.data.status });
  });
  // The handlers that treat an unreadable body as an empty one.
  hono.post('/api/app/legal-holds/:id/release', async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    return c.json({ received: body });
  });
  // A SyntaxError that is not the body's: still the defect it is.
  hono.post('/api/app/broken', async (c) => {
    await c.req.json();
    return c.json(JSON.parse('{stored') as unknown);
  });
  return hono;
}

const post = (
  path: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  app().request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('appJsonBody', () => {
  it.each([
    ['an empty body', ''],
    ['a truncated body', '{"status":"do'],
    ['a body that is not JSON', 'status=done'],
  ])(
    'answers %s with 400 INVALID_JSON and the request id',
    async (_n, body) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await post('/api/app/tasks/t1/move', body, {
        'x-request-id': 'req-json',
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        error: INVALID_JSON_MESSAGE,
        code: 'INVALID_JSON',
        requestId: 'req-json',
      });
      // Nothing reached the reporting half of the handler.
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it('parses a valid body exactly as before', async () => {
    const res = await post('/api/app/tasks/t1/move', '{"status":"done"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'done' });
  });

  it('keeps a handler’s own fallback for an unreadable body', async () => {
    const res = await post('/api/app/legal-holds/h1/release', '');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: {} });
  });

  it('leaves a SyntaxError that is not the body’s to the handler as a 500', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post('/api/app/broken', '{}');
    expect(res.status).toBe(500);
    expect(errors).toHaveBeenCalled();
  });

  it('passes a failed read that is not a parse failure through unchanged', async () => {
    const hono = new Hono();
    const seen: unknown[] = [];
    hono.onError((err, c) => {
      seen.push(err);
      return c.text('seen', 500);
    });
    hono.use('/api/app/*', appJsonBody());
    hono.post('/api/app/upload', async (c) => c.json(await c.req.json()));
    const aborted = Object.assign(new Error('aborted'), {
      code: 'ECONNRESET',
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.error(aborted);
      },
    });
    const res = await hono.request('http://localhost/api/app/upload', {
      method: 'POST',
      body,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- duplex is required for stream bodies and missing from the lib type
      ...({ duplex: 'half' } as unknown as RequestInit),
    });
    expect(res.status).toBe(500);
    expect(seen).toEqual([aborted]);
  });
});
