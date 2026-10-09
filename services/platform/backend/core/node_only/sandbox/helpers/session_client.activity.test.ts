import { createHash, createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sessionAcquire,
  sessionExecStatus,
  sessionDestroyIfIdle,
  sessionObserve,
  sessionReleaseIdle,
  sessionReleaseTicket,
  SpawnerBusyError,
  SpawnerUnreachableError,
} from './session_client.ts';

beforeEach(() => {
  vi.stubEnv('SANDBOX_TOKEN', 'activity-client-test');
  vi.stubEnv('SANDBOX_URL', 'http://sandbox.test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** The spawner's answer while a create of the id is in flight, its backend
 * listing timed out, or the container is still starting. */
function sessionUnavailable(): Response {
  return Response.json(
    { error: 'session_unavailable' },
    { status: 503, headers: { 'retry-after': '1' } },
  );
}

/** What the runtime's fetch throws when the spawner does not take the
 * connection: the syscall's code rides the failure's `cause`. */
function connectionFailure(code: string): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`connect ${code} 10.0.0.7:8003`), { code }),
  });
}

describe('runtime acquisition and release transport', () => {
  it('forwards watchdog cancellation into the signed cleanup request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ destroyed: false, busy: true }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await expect(
      sessionDestroyIfIdle('session-1', { signal: controller.signal }),
    ).resolves.toEqual({ destroyed: false, busy: true });
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    const reason = new Error('watchdog pass deadline');
    controller.abort(reason);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(reason);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

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

describe('recovery status probe budget', () => {
  it('forwards recovery cancellation and preserves running/exited/gone responses', async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ state: 'running', startedAtMs: 12 }),
      )
      .mockResolvedValueOnce(Response.json({ state: 'exited', exitCode: 7 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    expect(
      await sessionExecStatus('s', 'e', {
        signal: controller.signal,
        timeoutMs: 1000,
      }),
    ).toEqual({ state: 'running', startedAtMs: 12 });
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    expect(await sessionExecStatus('s', 'e')).toEqual({
      state: 'exited',
      exitCode: 7,
    });
    expect(await sessionExecStatus('s', 'e')).toEqual({ state: 'gone' });
  });

  it('uses the recovery caller’s remaining deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ state: 'running' })),
    );
    try {
      await sessionExecStatus('s', 'e', { timeoutMs: 123 });
      expect(timeout).toHaveBeenCalledWith(123);
    } finally {
      timeout.mockRestore();
    }
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

describe('a warm acquire across transient spawner answers', () => {
  it('asks again at the retry-after while the spawner answers session_unavailable', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionUnavailable())
      .mockResolvedValueOnce(sessionUnavailable())
      .mockResolvedValueOnce(Response.json({ generation: 'use-1' }));
    vi.stubGlobal('fetch', fetcher);

    const acquired = sessionAcquire('session-1');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(acquired).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('fails once session_unavailable outlasts its 20-second budget', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => sessionUnavailable());
    vi.stubGlobal('fetch', fetcher);

    const acquired = sessionAcquire('session-1').catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fetcher).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(1_000);

    const error = await acquired;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/Sandbox acquisition unavailable \(503\)/);
    expect(fetcher).toHaveBeenCalledTimes(21);
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'])(
    'waits out a restarting spawner that answers %s',
    async (code) => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(connectionFailure(code))
        .mockRejectedValueOnce(connectionFailure(code))
        .mockResolvedValueOnce(Response.json({ generation: 'use-1' }));
      vi.stubGlobal('fetch', fetcher);

      const acquired = sessionAcquire('session-1');
      // A doubling backoff: 250 ms, then 500 ms.
      await vi.advanceTimersByTimeAsync(750);

      await expect(acquired).resolves.toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it('fails a spawner that stays away past the budget, and any other connection failure at once', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = vi
      .fn<typeof fetch>()
      .mockRejectedValue(connectionFailure('ECONNREFUSED'));
    vi.stubGlobal('fetch', refused);
    const acquired = sessionAcquire('session-1').catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await acquired).toBeInstanceOf(SpawnerUnreachableError);
    // 250 + 500 + 1000 + 2000 + 4000 + 5000 + 5000 ms of waits fit in 20 s.
    expect(refused).toHaveBeenCalledTimes(8);

    const misnamed = vi
      .fn<typeof fetch>()
      .mockRejectedValue(connectionFailure('ENOTFOUND'));
    vi.stubGlobal('fetch', misnamed);
    await expect(sessionAcquire('session-1')).rejects.toBeInstanceOf(
      SpawnerUnreachableError,
    );
    expect(misnamed).toHaveBeenCalledTimes(1);
  });
});
