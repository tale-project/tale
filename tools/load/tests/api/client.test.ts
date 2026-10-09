import { describe, expect, test } from 'bun:test';

import {
  ApiClient,
  HeldRequester,
  type Requester,
  discardingMetrics,
  errorCodeOf,
  idsOf,
  rowsOf,
} from '../../src/api/client.ts';
import {
  HttpResponse,
  type HttpRequestOptions,
} from '../../src/client/index.ts';
import { MetricsRegistry } from '../../src/metrics/index.ts';

/** A requester answering from a table, recording the expect list it got. */
function fakeRequester(
  answer: (options: HttpRequestOptions) => {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
    delayMs?: number;
  },
): Requester & { seen: HttpRequestOptions[] } {
  const seen: HttpRequestOptions[] = [];
  return {
    seen,
    async request<T>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
      seen.push(options);
      const { status, body, headers, delayMs } = answer(options);
      if (delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const ok = (options.expect ?? []).includes(status);
      return new HttpResponse<T>({
        status,
        ok,
        headers: headers ?? {},
        ms: 5,
        text: body === undefined ? '' : JSON.stringify(body),
        cacheHit: false,
        errorKind: ok ? undefined : `http_${status}`,
      });
    },
  };
}

describe('ApiClient', () => {
  test('a declared refusal is an expected outcome with its code', async () => {
    const requester = fakeRequester(() => ({
      status: 503,
      body: { error: 'OBJECT_STORE_UNCONFIGURED', message: 'none' },
    }));
    const api = new ApiClient({ requester });
    const result = await api.call<unknown>({
      method: 'POST',
      path: '/api/app/files/blob-upload',
      name: 'POST /api/app/files/blob-upload',
      refusals: [503],
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.code).toBe('OBJECT_STORE_UNCONFIGURED');
    expect(result.body).toBeUndefined();
    const expected = requester.seen[0]?.expect ?? [];
    expect(expected).toContain(503);
    expect(expected).toContain(429);
    expect(expected).toContain(200);
  });

  test('an explicit expect list replaces the defaults', async () => {
    const requester = fakeRequester(() => ({ status: 400 }));
    const api = new ApiClient({ requester });
    await api.call({
      method: 'GET',
      path: '/x',
      name: 'GET /x',
      expect: [400, 422],
      refusals: [503],
    });
    expect(requester.seen[0]?.expect).toEqual([400, 422]);
  });

  test('the observer sees every completed response', async () => {
    const seen: [string, number][] = [];
    const requester = fakeRequester(() => ({
      status: 429,
      headers: { 'retry-after': '3' },
    }));
    const api = new ApiClient({
      requester,
      observer: { onResponse: (name, r) => seen.push([name, r.status]) },
    });
    await api.call({ method: 'GET', path: '/y', name: 'GET /y' });
    expect(seen).toEqual([['GET /y', 429]]);
  });

  test('a stopped user abandons a request in flight at once', async () => {
    const controller = new AbortController();
    const requester = fakeRequester(() => ({ status: 200, delayMs: 2_000 }));
    let observed = 0;
    const api = new ApiClient({
      requester,
      signal: controller.signal,
      observer: { onResponse: () => (observed += 1) },
    });
    const started = performance.now();
    const pending = api.call({ method: 'GET', path: '/slow', name: 'GET /s' });
    setTimeout(() => controller.abort(), 20);
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(observed).toBe(0);
    // Already stopped: nothing is sent at all.
    const again = await api.call({ method: 'GET', path: '/z', name: 'GET /z' });
    expect(again.aborted).toBe(true);
    expect(requester.seen).toHaveLength(1);
  });
});

describe('HeldRequester', () => {
  test('records a held request as a timing, never as an HTTP request', async () => {
    const metrics = new MetricsRegistry();
    const inner = fakeRequester(() => ({ status: 500, body: { error: 'x' } }));
    const held = new HeldRequester(inner, metrics);
    await held.request({
      method: 'POST',
      path: '/api/app/chat/threads/t/messages',
      name: 'POST /api/app/chat/threads/:id/messages',
      expect: [200],
    });
    const snapshot = metrics.snapshot();
    const timing = snapshot.timings['POST /api/app/chat/threads/:id/messages'];
    expect(timing?.kind).toBe('timing');
    expect(
      snapshot.statuses['POST /api/app/chat/threads/:id/messages']?.['500'],
    ).toBe(1);
    expect(
      snapshot.errors['POST /api/app/chat/threads/:id/messages']?.http_500
        ?.count,
    ).toBe(1);
    expect(discardingMetrics()).toBe(discardingMetrics());
  });
});

describe('readers', () => {
  test('errorCodeOf reads both envelopes and ignores sentences', () => {
    expect(errorCodeOf({ code: 'API_KEY_CREATE_FORBIDDEN' })).toBe(
      'API_KEY_CREATE_FORBIDDEN',
    );
    expect(errorCodeOf({ error: 'OBJECT_STORE_UNCONFIGURED' })).toBe(
      'OBJECT_STORE_UNCONFIGURED',
    );
    expect(errorCodeOf({ error: 'thread not found' })).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
    expect(errorCodeOf('TEXT')).toBeUndefined();
  });

  test('rowsOf and idsOf survive any shape', () => {
    expect(rowsOf(undefined, 'rows')).toEqual([]);
    expect(rowsOf({ rows: 'nope' }, 'rows')).toEqual([]);
    const rows = rowsOf({ rows: [{ id: 'a' }, 3, null, { _id: 'b' }] }, 'rows');
    expect(rows).toHaveLength(2);
    expect(idsOf(rows)).toEqual(['a', 'b']);
  });
});
