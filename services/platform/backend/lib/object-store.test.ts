/**
 * `fetchPresignedObject` — the bounded GET the audio serve and the
 * sandbox-blob stage use for a presigned bucket URL. Both used to call
 * `fetch(url)` with no signal, so a store that accepted the connection and
 * never answered pinned the request for ever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPresignedObject,
  PRESIGNED_FETCH_HEADER_TIMEOUT_MS,
} from './object-store.ts';

/** A `fetch` stand-in that never answers until `respond` is called, and
 * rejects the way the real one does when its signal aborts. */
function hangingFetch() {
  const seen: { url: string; signal: AbortSignal | undefined }[] = [];
  let respond: (response: Response) => void = () => undefined;
  const impl = vi.fn((url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    seen.push({ url, signal });
    return new Promise<Response>((resolve, reject) => {
      respond = resolve;
      const onAbort = () => reject(signal?.reason);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  });
  vi.stubGlobal('fetch', impl);
  return { seen, respond: (response: Response) => respond(response) };
}

describe('fetchPresignedObject', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hands fetch an AbortSignal and times out the header wait', async () => {
    const { seen } = hangingFetch();
    const pending = fetchPresignedObject('https://bucket.test/k?sig=1');
    expect(seen[0]?.url).toBe('https://bucket.test/k?sig=1');
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    // Attach the expectation before the clock fires, or the rejection lands
    // unhandled while the timers advance.
    const refused = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(PRESIGNED_FETCH_HEADER_TIMEOUT_MS + 1);
    await refused;
  });

  it('stops the clock once headers arrive — a long body is not cut short', async () => {
    const { seen, respond } = hangingFetch();
    const pending = fetchPresignedObject('https://bucket.test/k', {
      headerTimeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(500);
    respond(new Response('bytes'));
    const response = await pending;
    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen[0]?.signal?.aborted).toBe(false);
  });

  it('lets go of the caller signal once the fetch has rejected, but not after headers', async () => {
    const { respond } = hangingFetch();
    const timedOut = new AbortController();
    const removed = vi.spyOn(timedOut.signal, 'removeEventListener');
    const pending = fetchPresignedObject('https://bucket.test/k', {
      signal: timedOut.signal,
      headerTimeoutMs: 1_000,
    });
    const refused = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await refused;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));

    const streaming = new AbortController();
    const kept = vi.spyOn(streaming.signal, 'removeEventListener');
    const served = fetchPresignedObject('https://bucket.test/k2', {
      signal: streaming.signal,
    });
    respond(new Response('bytes'));
    await served;
    expect(kept).not.toHaveBeenCalled();
  });

  it('forwards the caller abort to the upstream fetch', async () => {
    const { seen } = hangingFetch();
    const client = new AbortController();
    const pending = fetchPresignedObject('https://bucket.test/k', {
      signal: client.signal,
    });
    client.abort(new DOMException('client left', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen[0]?.signal?.aborted).toBe(true);
  });

  it('keeps forwarding the caller abort after headers, so the stream tears down', async () => {
    const { seen, respond } = hangingFetch();
    const client = new AbortController();
    const pending = fetchPresignedObject('https://bucket.test/k', {
      signal: client.signal,
    });
    respond(new Response('bytes'));
    await pending;
    expect(seen[0]?.signal?.aborted).toBe(false);
    client.abort();
    expect(seen[0]?.signal?.aborted).toBe(true);
  });

  it('refuses immediately when the caller signal is already aborted', async () => {
    const { seen } = hangingFetch();
    const client = new AbortController();
    client.abort();
    await expect(
      fetchPresignedObject('https://bucket.test/k', { signal: client.signal }),
    ).rejects.toBeDefined();
    expect(seen[0]?.signal?.aborted).toBe(true);
  });
});
