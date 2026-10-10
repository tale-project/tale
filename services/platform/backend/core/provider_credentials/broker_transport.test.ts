import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  safeFetch,
  SafeFetchError,
  setSafeFetchResolverForTests,
  type ResolvedAddress,
  type SafeFetchResponse,
} from '../../../lib/net/safe-fetch';
import {
  brokerTransportDeadline,
  withBrokerTransport,
  type BrokerTransportScope,
} from './broker_transport';

function response(status = 200, retryAfter?: string): SafeFetchResponse {
  return {
    status,
    statusText: '',
    body: '{}',
    finalUrl: 'https://broker.example/pool',
    headers: new Headers(
      retryAfter === undefined ? {} : { 'retry-after': retryAfter },
    ),
  };
}

function settled<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
}

function fixture(
  extra: Partial<Pick<BrokerTransportScope, 'deadlineAt' | 'signal'>> = {},
) {
  const scope = {
    deadlineAt: Date.now() + 120_000,
    assertCurrent: vi.fn(async () => {}),
    ...extra,
  };
  const credential = vi.fn(async () => {});
  const fetch = vi.fn(async (_remaining: number, _signal: AbortSignal) =>
    response(),
  );
  return {
    scope,
    credential,
    fetch,
    run: () =>
      settled(
        withBrokerTransport(scope, credential, (transport) =>
          transport.request(fetch),
        ),
      ),
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'],
  });
  vi.setSystemTime(new Date('2026-10-08T04:30:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('backs off 5s then10s and stops after three requests', async () => {
  const f = fixture();
  f.fetch.mockResolvedValue(response(521));
  const result = f.run();
  await vi.advanceTimersByTimeAsync(4_999);
  expect(f.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(f.fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).value?.status).toBe(521);
  expect(f.fetch).toHaveBeenCalledTimes(3);
  expect(f.fetch.mock.calls.map(([remaining]) => remaining)).toEqual([
    60_000, 55_000, 45_000,
  ]);
});

it.each(['network_error', 'dns_failed', 'timeout'] as const)(
  'recovers typed %s only',
  async (kind) => {
    const f = fixture();
    f.fetch.mockRejectedValueOnce(
      new SafeFetchError(kind, 'synthetic diagnostic'),
    );
    const result = f.run();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await result).value?.status).toBe(200);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  },
);

it.each([
  'tls_error',
  'aborted',
  'private_ip',
  'host_not_allowed',
  'response_too_large',
  'redirect_limit_exceeded',
] as const)('does not retry %s', async (kind) => {
  const f = fixture();
  const error = new SafeFetchError(kind, 'synthetic diagnostic');
  f.fetch.mockRejectedValue(error);
  expect((await f.run()).error).toBe(error);
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('does not retry untyped errors that resemble a transport failure', async () => {
  const f = fixture();
  const error = new Error('HTTP521 timeout');
  f.fetch.mockRejectedValue(error);
  expect((await f.run()).error).toBe(error);
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it.each([400, 401, 403, 404, 429, 500, 522])(
  'does not retry HTTP%s',
  async (status) => {
    const f = fixture();
    f.fetch.mockResolvedValue(response(status));
    expect((await f.run()).value?.status).toBe(status);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  },
);

describe('Retry-After floors', () => {
  it.each(['12', 'Thu, 08 Oct 2026 04:30:12 GMT'])(
    'honors %s even across a wall-clock jump',
    async (header) => {
      const f = fixture();
      f.fetch.mockResolvedValueOnce(response(503, header));
      const result = f.run();
      await vi.advanceTimersByTimeAsync(1);
      vi.setSystemTime(new Date('2026-10-07T04:30:00Z'));
      await vi.advanceTimersByTimeAsync(11_998);
      expect(f.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await result).value?.status).toBe(200);
      expect(f.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['0', 'Thu, 08 Oct 2026 04:29:00 GMT'])(
    'keeps local backoff for %s',
    async (header) => {
      const f = fixture();
      f.fetch.mockResolvedValueOnce(response(503, header));
      const result = f.run();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(f.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await result).value?.status).toBe(200);
    },
  );

  it.each(['60', '9999999999999999999999999', '-1', '1.5', 'later', '1, 2'])(
    'holds without shortening %s',
    async (header) => {
      const f = fixture();
      f.fetch.mockResolvedValue(response(503, header));
      expect((await f.run()).value?.status).toBe(503);
      expect(f.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'Abc, 08 Oct 2026 04:30:12 GMT',
    'Mon, 08 Oct 2026 04:30:12 GMT',
    'Thu, 31 Feb 2026 04:30:12 GMT',
  ])('refuses a noncanonical HTTP date: %s', async (header) => {
    const f = fixture();
    f.fetch.mockResolvedValue(response(503, header));
    const result = f.run();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await result).value?.status).toBe(503);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});

it('aborts backoff on the existing job signal', async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  f.fetch.mockResolvedValue(response(521));
  const result = f.run();
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect((await result).error).toMatchObject({ kind: 'aborted' });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('refuses late DNS completion without abandoning the resolver or dialing', async () => {
  const dns = Promise.withResolvers<readonly ResolvedAddress[]>();
  const lookup = vi.fn(() => dns.promise);
  const fetch = vi.fn();
  const f = fixture();
  setSafeFetchResolverForTests(lookup);
  vi.stubGlobal('fetch', fetch);
  f.fetch.mockImplementation((remaining, signal) =>
    safeFetch('https://broker.example/pool', {
      timeoutMs: Math.min(30_000, remaining),
      signal,
    }),
  );
  const result = f.run();
  let finished = false;
  void result.then(() => {
    finished = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    dns.resolve([{ address: '8.8.8.8', family: 4 }]);
    expect((await result).error).toMatchObject({ kind: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    dns.resolve([]);
    await result;
    setSafeFetchResolverForTests(null);
    vi.unstubAllGlobals();
  }
});

it('forwards job abort to the in-flight response without exposing its reason', async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  f.fetch.mockImplementation(
    (_ms, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new SafeFetchError('aborted', 'request aborted')),
          { once: true },
        );
      }),
  );
  const result = f.run();
  await vi.advanceTimersByTimeAsync(1);
  controller.abort(new Error('synthetic-secret'));
  expect((await result).error).toMatchObject({
    kind: 'aborted',
    message: 'Broker transport stopped.',
  });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('refuses an already-aborted job before reading or fetching', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture({ signal: controller.signal });
  expect((await f.run()).error).toMatchObject({ kind: 'aborted' });
  expect(f.credential).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
});

it('observes native cancellation before another request, without polling while sleeping', async () => {
  const f = fixture();
  f.fetch.mockResolvedValue(response(521));
  const result = f.run();
  await vi.advanceTimersByTimeAsync(1);
  const calls = f.scope.assertCurrent.mock.calls.length;
  f.scope.assertCurrent.mockRejectedValue(new Error('native cancellation'));
  await vi.advanceTimersByTimeAsync(4_998);
  expect(f.scope.assertCurrent).toHaveBeenCalledTimes(calls);
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).error).toMatchObject({
    message: 'native cancellation',
  });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('refuses a result when authority changes at final publication', async () => {
  const f = fixture();
  f.scope.assertCurrent
    .mockResolvedValueOnce()
    .mockResolvedValueOnce()
    .mockRejectedValue(new Error('rotated'));
  expect((await f.run()).error).toMatchObject({ message: 'rotated' });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('rechecks native authority after the final awaited credential read', async () => {
  const f = fixture();
  let live = true;
  f.scope.assertCurrent.mockImplementation(async () => {
    if (!live) throw new Error('native run rotated during credential read');
  });
  let reads = 0;
  f.credential.mockImplementation(async () => {
    if (++reads === 3) live = false;
  });
  expect((await f.run()).error).toMatchObject({
    message: 'native run rotated during credential read',
  });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('counts initial lookup time and awaits a late query without publishing its result', async () => {
  const f = fixture();
  const deadline = brokerTransportDeadline(f.scope);
  await vi.advanceTimersByTimeAsync(59_000);
  let finish: (() => void) | undefined;
  f.credential.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const result = settled(
    withBrokerTransport(
      f.scope,
      f.credential,
      (transport) => transport.request(f.fetch),
      deadline,
    ),
  );
  await vi.advanceTimersByTimeAsync(2_000);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(finish).toBeDefined();
  finish?.();
  expect((await result).error).toMatchObject({ kind: 'aborted' });
});

it('caps the request at native remaining time and refuses its late completion', async () => {
  const f = fixture({ deadlineAt: Date.now() + 1_000 });
  let finish: ((value: SafeFetchResponse) => void) | undefined;
  f.fetch.mockImplementation(
    () =>
      new Promise<SafeFetchResponse>((resolve) => {
        finish = resolve;
      }),
  );
  const result = f.run();
  await vi.advanceTimersByTimeAsync(1_001);
  expect(f.fetch.mock.calls[0]?.[0]).toBe(1_000);
  expect(f.fetch.mock.calls[0]?.[1].aborted).toBe(true);
  finish?.(response());
  expect((await result).error).toMatchObject({ kind: 'aborted' });
});
