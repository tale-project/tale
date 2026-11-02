import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { POLL_FAST_MS, POLL_SLOW_MS } from '@/app/lib/polling';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { proxy, proxyCheck } from '@/tests/utils/fixtures';
import { proxyPool } from '@/tests/utils/proxies-api';
import { renderHookApp } from '@/tests/utils/render';

import { PROXIES_FIRST_WINDOW, useProxyList } from './use-proxy-list';

const pool = (size: number) =>
  Array.from({ length: size }, (_unused, index) => proxy({ id: index + 1 }));

afterEach(() => {
  vi.useRealTimers();
});

describe('useProxyList', () => {
  it('asks for the newest window and says whether there are more', async () => {
    const rows = pool(200);
    const api = installFakeApi({ 'GET /proxies': proxyPool(() => rows) });
    const { result } = renderHookApp(useProxyList);

    expect(result.current.status).toBe('LoadingFirstPage');
    expect(result.current.isPending).toBe(true);
    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW),
    );

    expect(api.callsTo('GET /proxies')[0]?.query.get('limit')).toBe(
      String(PROXIES_FIRST_WINDOW),
    );
    expect(result.current.proxies[0]?.id).toBe(200);
    expect(result.current.total).toBe(200);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.status).toBe('CanLoadMore');
  });

  it('is exhausted once every proxy is loaded', async () => {
    installFakeApi({ 'GET /proxies': proxyPool(() => pool(3)) });
    const { result } = renderHookApp(useProxyList);

    await waitFor(() => expect(result.current.proxies).toHaveLength(3));

    expect(result.current.hasMore).toBe(false);
    expect(result.current.status).toBe('Exhausted');
  });

  it('widens the window on loadMore, keeping the rows meanwhile', async () => {
    const rows = pool(300);
    const api = installFakeApi({ 'GET /proxies': proxyPool(() => rows) });
    const { result } = renderHookApp(useProxyList);
    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW),
    );

    act(() => result.current.loadMore(20));

    // The wider window is on its way: the rows of the narrow one stay.
    expect(result.current.status).toBe('LoadingMore');
    expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW);
    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW * 2),
    );
    expect(
      api.callsTo('GET /proxies').map((call) => call.query.get('limit')),
    ).toContain(String(PROXIES_FIRST_WINDOW * 2));
    expect(result.current.status).toBe('CanLoadMore');
  });

  it('widens by what it is asked when that is more than doubling', async () => {
    const rows = pool(500);
    const api = installFakeApi({ 'GET /proxies': proxyPool(() => rows) });
    const { result } = renderHookApp(useProxyList);
    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW),
    );

    act(() => result.current.loadMore(PROXIES_FIRST_WINDOW * 3));

    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW * 4),
    );
    expect(
      api.callsTo('GET /proxies').map((call) => call.query.get('limit')),
    ).toContain(String(PROXIES_FIRST_WINDOW * 4));
  });

  it('asks for the same widening twice at the price of one', async () => {
    const rows = pool(300);
    const api = installFakeApi({ 'GET /proxies': proxyPool(() => rows) });
    const { result } = renderHookApp(useProxyList);
    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW),
    );

    act(() => {
      result.current.loadMore(20);
      result.current.loadMore(20);
    });

    await waitFor(() =>
      expect(result.current.proxies).toHaveLength(PROXIES_FIRST_WINDOW * 2),
    );
    expect(api.callsTo('GET /proxies')).toHaveLength(2);
  });

  it('asks for nothing more when everything is loaded', async () => {
    const api = installFakeApi({ 'GET /proxies': proxyPool(() => pool(5)) });
    const { result } = renderHookApp(useProxyList);
    await waitFor(() => expect(result.current.proxies).toHaveLength(5));

    act(() => result.current.loadMore(60));

    expect(result.current.status).toBe('Exhausted');
    expect(api.callsTo('GET /proxies')).toHaveLength(1);
  });

  it('says what failed, and tries again on request', async () => {
    const api = installFakeApi({ 'GET /proxies': failure(500, 'boom') });
    const { result } = renderHookApp(useProxyList);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.proxies).toEqual([]);

    api.on(
      'GET /proxies',
      proxyPool(() => pool(2)),
    );
    await act(() => result.current.refetch());

    await waitFor(() => expect(result.current.proxies).toHaveLength(2));
    expect(result.current.isError).toBe(false);
  });
});

describe('useProxyList polling', () => {
  it('polls quickly while a row is being checked, then slowly', async () => {
    vi.useFakeTimers();
    let rows = [proxy({ id: 1, check: proxyCheck({ status: 'checking' }) })];
    const api = installFakeApi({ 'GET /proxies': proxyPool(() => rows) });
    const { result } = renderHookApp(useProxyList);
    await vi.advanceTimersByTimeAsync(50);
    expect(result.current.proxies[0]?.check.status).toBe('checking');
    expect(api.callsTo('GET /proxies')).toHaveLength(1);

    // The check ends before the next read, which then sees it.
    rows = [proxy({ id: 1, check: proxyCheck({ status: 'ok' }) })];
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(api.callsTo('GET /proxies')).toHaveLength(2);
    expect(result.current.proxies[0]?.check.status).toBe('ok');

    // Nothing runs any more: the next read is not due for the slow interval.
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS - 100);
    expect(api.callsTo('GET /proxies')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(api.callsTo('GET /proxies')).toHaveLength(3);
  });

  it('waits longer after every try that fails while the server does not answer', async () => {
    vi.useFakeTimers();
    const api = installFakeApi({ 'GET /proxies': failure(500, 'boom') });
    const { result } = renderHookApp(useProxyList);
    await vi.advanceTimersByTimeAsync(50);
    expect(result.current.isError).toBe(true);
    expect(api.callsTo('GET /proxies')).toHaveLength(1);

    // The first failure waits the ordinary 5 seconds, the second 10.
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS - 100);
    expect(api.callsTo('GET /proxies')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(api.callsTo('GET /proxies')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2 * POLL_SLOW_MS - 300);
    expect(api.callsTo('GET /proxies')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(api.callsTo('GET /proxies')).toHaveLength(3);
  });
});
