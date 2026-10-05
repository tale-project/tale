// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isBackendReachable, reportBackendReachable } from './connection-state';
import { backendKey } from './query-keys';
import { settingsReadAdapters } from './settings';
import { HINT_BATCH_MS, useBackendHints } from './use-backend-hints';

/** A controllable EventSource double: tests dispatch named SSE events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  /** 0 CONNECTING (the browser is retrying), 1 OPEN, 2 CLOSED (it gave up). */
  readyState = 1;
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent<string>) => void>
  >();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent<string>(type, { data }));
    }
  }
}

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient();
  FakeEventSource.instances = [];
  window.__ENV__ = { BASE_PATH: '' };
  vi.stubGlobal('EventSource', FakeEventSource);
  // Every stream error triggers a health probe; answer it unless a test
  // says otherwise, so an abandoned handshake never reads as an outage.
  vi.spyOn(window, 'fetch').mockResolvedValue(
    new Response('ok', { status: 200 }),
  );
});

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__ENV__;
  reportBackendReachable();
});

/** Hints gather for a short window before their reads refresh. */
function flushHints(): void {
  act(() => {
    vi.advanceTimersByTime(HINT_BATCH_MS);
  });
}

/** The browser abandoned the handshake (non-200) and will not retry. */
function abandon(source: FakeEventSource | undefined): void {
  act(() => {
    if (source !== undefined) {
      source.readyState = 2;
      source.emit('error', '');
    }
  });
}

describe('useBackendHints', () => {
  it('refreshes each active read once for a burst of task hints', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => ({ version: 1 }));
    const observer = new QueryObserver(queryClient, {
      queryKey: backendKey('org1', 'task', 'by-project', 'p1'),
      queryFn: read,
      initialData: { version: 0 },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    renderHook(() => useBackendHints('org1'), { wrapper });

    act(() => {
      for (let i = 0; i < 100; i += 1) {
        FakeEventSource.instances[0]?.emit(
          'hint',
          JSON.stringify({ entity: 'task', entityId: `t${i}` }),
        );
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toEqual({ version: 1 });
    unsubscribe();
  });

  it('finishes an active refresh and then refreshes once for hints that arrived during it', async () => {
    vi.useFakeTimers();
    const finishes: Array<() => void> = [];
    const aborted = vi.fn();
    const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener('abort', aborted);
      const version = finishes.length + 1;
      return new Promise<{ version: number }>((resolve) => {
        finishes.push(() => resolve({ version }));
      });
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: backendKey('org1', 'task', 'by-project', 'p1'),
      queryFn: read,
      initialData: { version: 0 },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() => {
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'task', entityId: 't1' }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(read).toHaveBeenCalledTimes(1);

    act(() => {
      for (let i = 0; i < 25; i += 1) {
        FakeEventSource.instances[0]?.emit(
          'hint',
          JSON.stringify({ entity: 'task', entityId: 't1' }),
        );
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(aborted).not.toHaveBeenCalled();

    await act(async () => finishes[0]?.());
    expect(observer.getCurrentResult().data).toEqual({ version: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => finishes[1]?.());
    expect(observer.getCurrentResult().data).toEqual({ version: 2 });
    expect(aborted).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not lose a hint that overlaps a read already in flight', async () => {
    vi.useFakeTimers();
    const finishes: Array<() => void> = [];
    const read = vi.fn(() => {
      const version = finishes.length + 1;
      return new Promise<{ version: number }>((resolve) => {
        finishes.push(() => resolve({ version }));
      });
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: backendKey('org1', 'task', 'detail', 't1'),
      queryFn: read,
      initialData: { version: 0 },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    renderHook(() => useBackendHints('org1'), { wrapper });
    void observer.refetch();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => {
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'task', entityId: 't1' }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => finishes[0]?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => finishes[1]?.());
    expect(observer.getCurrentResult().data).toEqual({ version: 2 });
    unsubscribe();
  });

  it('refreshes another entity while a task refresh is still pending', async () => {
    vi.useFakeTimers();
    let finishTask = (): void => {};
    const taskRead = vi.fn(
      () =>
        new Promise<{ version: number }>((resolve) => {
          finishTask = () => resolve({ version: 1 });
        }),
    );
    const documentRead = vi.fn(async () => ({ version: 1 }));
    const observers = [
      new QueryObserver(queryClient, {
        queryKey: backendKey('org1', 'task', 'detail', 't1'),
        queryFn: taskRead,
        initialData: { version: 0 },
        staleTime: Infinity,
      }),
      new QueryObserver(queryClient, {
        queryKey: backendKey('org1', 'document', 'detail', 'd1'),
        queryFn: documentRead,
        initialData: { version: 0 },
        staleTime: Infinity,
      }),
    ];
    const unsubscribes = observers.map((observer) =>
      observer.subscribe(() => {}),
    );
    renderHook(() => useBackendHints('org1'), { wrapper });
    for (const entity of ['task', 'document', 'document']) {
      act(() => {
        FakeEventSource.instances[0]?.emit(
          'hint',
          JSON.stringify({ entity, entityId: 'changed' }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
      });
    }
    expect(taskRead).toHaveBeenCalledTimes(1);
    expect(documentRead).toHaveBeenCalledTimes(2);
    await act(async () => finishTask());
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('coalesces project and task hints without crossing organizations', async () => {
    vi.useFakeTimers();
    const own = ['project', 'project_capability', 'task', 'chat_thread'].map(
      (entity) => backendKey('org1', entity, 'list'),
    );
    const other = backendKey('org2', 'task', 'list');
    const unrelated = backendKey('org1', 'conversation', 'list');
    for (const key of [...own, other, unrelated])
      queryClient.setQueryData(key, []);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() => {
      for (let i = 0; i < 25; i += 1) {
        for (const entity of ['project', 'task']) {
          FakeEventSource.instances[0]?.emit(
            'hint',
            JSON.stringify({ entity, entityId: `row${i}` }),
          );
        }
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    // One refresh per entity: the many projects widen to every capability
    // catalog rather than refreshing each project's separately.
    expect(invalidate).toHaveBeenCalledTimes(4);
    for (const key of own)
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of [other, unrelated])
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it.each(['unmount', 'forbidden', 'organization switch'])(
    'drops queued hints on %s',
    async (stop) => {
      vi.useFakeTimers();
      const key = backendKey('org1', 'task', 'list');
      queryClient.setQueryData(key, []);
      const { unmount, rerender } = renderHook(
        ({ orgId }) => useBackendHints(orgId),
        { wrapper, initialProps: { orgId: 'org1' } },
      );
      act(() => {
        FakeEventSource.instances[0]?.emit(
          'hint',
          JSON.stringify({ entity: 'task', entityId: 't1' }),
        );
      });
      if (stop === 'unmount') unmount();
      else if (stop === 'organization switch') rerender({ orgId: 'org2' });
      else act(() => FakeEventSource.instances[0]?.emit('forbidden', ''));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    },
  );

  it('refreshes project-dependent lists when another session changes a project', async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() =>
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'project', entityId: 'p1' }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      [
        ['backend', 'org1', 'project'],
        ['backend', 'org1', 'project_capability', 'p1'],
        ['backend', 'org1', 'task'],
        ['backend', 'org1', 'chat_thread'],
      ],
    );
  });

  it('refreshes knowledge-entry indexing when its backing document changes', async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() => {
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'document', entityId: null }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      [
        ['backend', 'org1', 'document'],
        ['backend', 'org1', 'knowledge_entry'],
      ],
    );
  });

  it('refreshes the organization’s key listing when a governance policy changes', async () => {
    vi.useFakeTimers();
    // The listing describes the keys the saved budget rules name. A budgets
    // save — from this tab, another session, or a configuration import or
    // rollback through the same door — reaches every open session as a
    // `governance_policy` hint, and the listing is keyed under `api_key`.
    const listingOf = (organizationId: string) => {
      const key = settingsReadAdapters['governance/api_keys:listOrgApiKeys']?.(
        { organizationId },
        {},
      )?.queryKey;
      if (key === undefined) throw new Error('no key listing read');
      return key;
    };
    const own = listingOf('org1');
    const otherOrg = listingOf('org2');
    const ownKeyAccess = backendKey('org1', 'api_key', 'my-access');
    for (const key of [own, otherOrg, ownKeyAccess]) {
      queryClient.setQueryData(key, []);
    }
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() => {
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'governance_policy', entityId: 'budgets' }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(queryClient.getQueryState(own)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherOrg)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(ownKeyAccess)?.isInvalidated).toBe(false);
  });

  it('subscribes the org stream and invalidates the entity prefix on a hint', async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });

    const source = FakeEventSource.instances[0];
    expect(source?.url).toBe('/events?orgId=org1');
    expect(source?.withCredentials).toBe(true);

    act(() => {
      source?.emit('hint', JSON.stringify({ entity: 'task', entityId: 't1' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
    });
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: ['backend', 'org1', 'task'] },
      { cancelRefetch: false },
    );
  });

  it('refreshes an entity once for a burst of its hints', () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });
    const source = FakeEventSource.instances[0];

    act(() => {
      for (const id of ['t1', 't2', 't3', 't4', 't5']) {
        source?.emit('hint', JSON.stringify({ entity: 'task', entityId: id }));
      }
      source?.emit(
        'hint',
        JSON.stringify({ entity: 'project', entityId: 'p1' }),
      );
    });
    // Nothing restarts while the window gathers.
    expect(invalidate).not.toHaveBeenCalled();

    flushHints();
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      [
        ['backend', 'org1', 'task'],
        ['backend', 'org1', 'project'],
        ['backend', 'org1', 'project_capability', 'p1'],
        ['backend', 'org1', 'chat_thread'],
      ],
    );
  });

  it('widens to every capability catalog when several projects change in one window', () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });
    const source = FakeEventSource.instances[0];

    act(() => {
      for (const id of ['p1', 'p1', 'p2']) {
        source?.emit(
          'hint',
          JSON.stringify({ entity: 'project', entityId: id }),
        );
      }
    });

    flushHints();
    const keys = invalidate.mock.calls.map(([options]) => options?.queryKey);
    expect(keys.filter((key) => key?.[2] === 'project_capability')).toEqual([
      ['backend', 'org1', 'project_capability'],
    ]);
  });

  it('refetches the whole org scope when the server cannot replay the gap (resync)', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() => {
      FakeEventSource.instances[0]?.emit('resync', '');
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['backend', 'org1'] });
  });

  it('closes the source on the terminal forbidden event instead of reconnecting', () => {
    renderHook(() => useBackendHints('org1'), { wrapper });
    const source = FakeEventSource.instances[0];
    expect(source?.closed).toBe(false);
    act(() => {
      source?.emit('forbidden', '');
    });
    // The server ended the stream because the reader lost the org or the
    // session; a native reconnect would only meet a 401/403.
    expect(source?.closed).toBe(true);
  });

  it('ignores malformed hint payloads without throwing', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => useBackendHints('org1'), { wrapper });

    act(() => {
      FakeEventSource.instances[0]?.emit('hint', 'not-json');
      FakeEventSource.instances[0]?.emit('hint', JSON.stringify({ nope: 1 }));
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('closes the stream on unmount and reopens on an org switch', () => {
    const { rerender, unmount } = renderHook(
      ({ orgId }: { orgId: string | undefined }) => useBackendHints(orgId),
      { wrapper, initialProps: { orgId: 'org1' as string | undefined } },
    );
    expect(FakeEventSource.instances).toHaveLength(1);

    rerender({ orgId: 'org2' });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(FakeEventSource.instances[1]?.url).toBe('/events?orgId=org2');

    unmount();
    expect(FakeEventSource.instances[1]?.closed).toBe(true);
  });

  it('keeps the backend reachable when EventSource errors but the health probe answers', async () => {
    // The probe is throttled while nothing is in doubt: move the clock past
    // any probe an earlier test started (fake Date only; timers stay real).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    expect(isBackendReachable()).toBe(true);
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () =>
        Response.json({ ok: true, service: 'backend' }),
      );
    renderHook(() => useBackendHints('org1'), { wrapper });
    await act(async () => {
      FakeEventSource.instances[0]?.emit('error', '');
    });
    // The error is not the verdict — the probe it triggers is.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health/ready',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(isBackendReachable()).toBe(true);
  });

  it('flags the backend unreachable when the probe an EventSource error triggers gets no response', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));
    renderHook(() => useBackendHints('org1'), { wrapper });
    await act(async () => {
      FakeEventSource.instances[0]?.emit('error', '');
      // A second error while the probe is in flight must not fire another.
      FakeEventSource.instances[0]?.emit('error', '');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isBackendReachable()).toBe(false);
  });

  it('opens nothing without an org scope', () => {
    renderHook(() => useBackendHints(undefined), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('reopens a stream the browser abandoned on a non-200 handshake', () => {
    vi.useFakeTimers();
    renderHook(() => useBackendHints('org1'), { wrapper });
    const first = FakeEventSource.instances[0];

    // What a rolling deploy does to an open tab: the handshake answers 502,
    // the browser sets CLOSED and never retries.
    abandon(first);
    expect(first?.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]?.url).toBe('/events?orgId=org1');
  });

  it('leaves a natively reconnecting stream alone', () => {
    vi.useFakeTimers();
    renderHook(() => useBackendHints('org1'), { wrapper });
    const source = FakeEventSource.instances[0];

    act(() => {
      // CONNECTING: the browser is already retrying with Last-Event-ID.
      if (source !== undefined) source.readyState = 0;
      source?.emit('error', '');
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source?.closed).toBe(false);
  });

  it('never reopens after the terminal forbidden event', () => {
    vi.useFakeTimers();
    renderHook(() => useBackendHints('org1'), { wrapper });
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.emit('forbidden', '');
    });
    abandon(source);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('refetches the org scope on the open that follows a forced reopen', () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });

    // The first open is not a gap — nothing was missed yet.
    act(() => {
      FakeEventSource.instances[0]?.emit('open', '');
    });
    expect(invalidate).not.toHaveBeenCalled();

    abandon(FakeEventSource.instances[0]);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // A reopened source carries no Last-Event-ID, so the hints emitted while
    // it was down are unrecoverable: the org scope has to refetch.
    act(() => {
      FakeEventSource.instances[1]?.emit('open', '');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['backend', 'org1'] });
  });

  it('backs off between reopen attempts and resets after one opens', () => {
    vi.useFakeTimers();
    renderHook(() => useBackendHints('org1'), { wrapper });

    abandon(FakeEventSource.instances[0]);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    // Second failure waits twice as long.
    abandon(FakeEventSource.instances[1]);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(FakeEventSource.instances).toHaveLength(3);

    // A stream that opens clears the debt: the next failure waits 1s again.
    act(() => {
      FakeEventSource.instances[2]?.emit('open', '');
    });
    abandon(FakeEventSource.instances[2]);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('cancels a pending reopen on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackendHints('org1'), { wrapper });

    abandon(FakeEventSource.instances[0]);
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
