import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import {
  HEALTHY_PROBE_INTERVAL_MS,
  PROBE_INTERVAL_MS,
  PROBE_SOON_MIN_GAP_MS,
  PROBE_TIMEOUT_MS,
  probeBackendSoon,
  reportBackendReachable,
  reportBackendUnreachable,
} from '@/app/lib/backend/connection-state';

import { useBackendConnectionState } from './use-backend-connection-state';

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setOnLine(true);
  reportBackendReachable();
  delete window.__ENV__;
});

describe('useBackendConnectionState', () => {
  it('detects a silent outage in a healthy idle tab and recovers on the fast loop', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockImplementation(
        async () =>
          new Response('<html>Proxy unavailable</html>', { status: 503 }),
      );
    const { result } = renderHook(() => useBackendConnectionState());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTHY_PROBE_INTERVAL_MS - 1);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.isWebSocketConnected).toBe(false);
    fetchMock.mockImplementation(async () =>
      Response.json({ ok: true, service: 'backend' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.isWebSocketConnected).toBe(true);
  });

  it('tracks the hint stream: optimistic until something actually fails', () => {
    const { result } = renderHook(() => useBackendConnectionState());
    // Nothing has failed yet — a request that was never tried is not
    // evidence of an outage.
    expect(result.current.isWebSocketConnected).toBe(true);

    act(() => {
      reportBackendUnreachable();
    });
    expect(result.current.isWebSocketConnected).toBe(false);

    act(() => {
      reportBackendReachable();
    });
    expect(result.current.isWebSocketConnected).toBe(true);
  });

  it('probes the backend on the offline event and flags it unreachable when nothing answers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useBackendConnectionState());

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isWebSocketConnected).toBe(false);
  });

  it('keeps probing every interval while unreachable and recovers once the backend answers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useBackendConnectionState());

    act(() => {
      reportBackendUnreachable();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isWebSocketConnected).toBe(false);

    fetchMock.mockImplementation(async () =>
      Response.json({ ok: true, service: 'backend' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.isWebSocketConnected).toBe(true);

    // Reachable and online: the loop stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps probing while the device reports offline even though the backend answers', async () => {
    // A laptop without WAN talking to a local backend: the overlay stays
    // hidden, but the probe keeps watching until the device is back online.
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () =>
        Response.json({ ok: true, service: 'backend' }),
      );
    const { result } = renderHook(() => useBackendConnectionState());

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isWebSocketConnected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops listening and probing once the last subscriber unmounts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const { unmount } = renderHook(() => useBackendConnectionState());
    act(() => {
      reportBackendUnreachable();
    });
    unmount();

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The hint stream's `error` fires on every reconnect attempt; each one
  // used to probe /api/health while nothing was in doubt.
  it('throttles the hint-stream probe while reachable and online', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () =>
        Response.json({ ok: true, service: 'backend' }),
      );
    renderHook(() => useBackendConnectionState());

    await act(async () => {
      probeBackendSoon();
      probeBackendSoon();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_SOON_MIN_GAP_MS / 2);
      probeBackendSoon();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROBE_SOON_MIN_GAP_MS / 2);
      probeBackendSoon();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives a slow backend the whole probe window before flagging it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-06-01T00:00:00Z'));
    // A fetch that answers only when aborted — the probe's own timeout.
    vi.spyOn(window, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useBackendConnectionState());

    await act(async () => {
      probeBackendSoon();
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    });
    expect(PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(8_000);
    expect(result.current.isWebSocketConnected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.isWebSocketConnected).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
