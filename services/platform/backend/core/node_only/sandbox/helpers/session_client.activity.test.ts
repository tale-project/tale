import { createHash, createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sessionAcquire,
  sessionObserve,
  sessionReleaseIdle,
  sessionReleaseTicket,
  SpawnerBusyError,
} from './session_client.ts';

beforeEach(() => {
  vi.stubEnv('SANDBOX_TOKEN', 'activity-client-test');
  vi.stubEnv('SANDBOX_URL', 'http://sandbox.test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runtime acquisition and release transport', () => {
  it('parks a warm acquisition refused for capacity instead of treating it as gone', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: 'host_memory', queue: { position: 2, waiting: 3 } },
          { status: 429, headers: { 'retry-after': '5' } },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const failed = await sessionAcquire('warm').catch(
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(SpawnerBusyError);
    expect(failed).toMatchObject({
      retryAfterMs: 5000,
      queue: { position: 2, waiting: 3 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('authenticates the session, verb and captured generation in every request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ generation: 'use-1' }))
      .mockResolvedValueOnce(Response.json({ generation: 'use-1' }))
      .mockResolvedValueOnce(Response.json({ released: true }));
    vi.stubGlobal('fetch', fetcher);

    expect(await sessionAcquire('session-1')).toBe(true);
    expect(await sessionReleaseTicket('session-1')).toBe('use-1');
    expect(await sessionReleaseIdle('session-1', 'use-1')).toBe(true);

    for (const [url, init] of fetcher.mock.calls) {
      if (typeof url !== 'string') throw new Error('Expected a signed URL');
      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? init.body : '';
      const signature = createHmac('sha256', 'activity-client-test')
        .update(
          `${init?.method}\n${path}\n${headers.get('x-tale-sandbox-timestamp')}\n${headers.get('x-tale-sandbox-nonce')}\n${createHash('sha256').update(body).digest('hex')}`,
        )
        .digest('hex');
      expect(headers.get('x-tale-sandbox-signature')).toBe(signature);
    }
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('GET');
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe('{"generation":"use-1"}');
  });

  it('treats only definite absence as recreatable or already released', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(null, { status: 404 })),
    );
    expect(await sessionAcquire('gone')).toBe(false);
    expect(await sessionReleaseTicket('gone')).toBeNull();
    expect(await sessionReleaseIdle('gone', 'use-1')).toBe(false);
  });

  it('supports old spawners during a rolling upgrade without weakening a new spawner’s acquire', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ sessionId: 'legacy' }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ maxSessions: 16 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await sessionAcquire('legacy')).toBe(true);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      'http://sandbox.test/v1/sessions/legacy',
    );
    expect(await sessionAcquire('new-spawner-gone')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('does not mistake an unavailable capability probe for legacy safety', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
    );
    await expect(sessionAcquire('unknown')).rejects.toThrow('503');
  });

  it.each([503, 403])('fails closed on HTTP %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(null, { status })),
    );
    await expect(sessionAcquire('session-1')).rejects.toThrow(String(status));
    await expect(sessionReleaseTicket('session-1')).rejects.toThrow(
      String(status),
    );
    await expect(sessionReleaseIdle('session-1', 'use-1')).rejects.toThrow(
      String(status),
    );
  });

  it('rejects an unproven acquisition or malformed idle acknowledgment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => Response.json({})),
    );
    await expect(sessionAcquire('session-1')).rejects.toThrow();
    await expect(sessionReleaseTicket('session-1')).rejects.toThrow();
    await expect(sessionReleaseIdle('session-1', 'use-1')).rejects.toThrow();
  });
});

it('classifies warm-acquire memory refusal as capacity parking with the retry hint', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: 'host_memory' },
        { status: 429, headers: { 'retry-after': '5' } },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  await expect(sessionAcquire('warm')).rejects.toMatchObject({
    name: 'SpawnerBusyError',
    retryAfterMs: 5000,
  });
  await expect(sessionAcquire('warm')).rejects.toBeInstanceOf(SpawnerBusyError);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reads liveness and runtime pin in one GET, preserving unknown older shapes', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ session: { pinned: true } }))
    .mockResolvedValueOnce(Response.json({ session: { pinned: false } }))
    .mockResolvedValueOnce(Response.json({ sessionId: 'old' }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await sessionObserve('pinned')).toEqual({
    pinned: true,
  });
  expect(await sessionObserve('unpinned')).toEqual({
    pinned: false,
  });
  expect(await sessionObserve('legacy')).toEqual({});
  expect(await sessionObserve('gone')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
