// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isBackendReachable, reportBackendReachable } from './connection-state';
import { useBackendHints } from './use-backend-hints';

/** A controllable EventSource double: tests dispatch named SSE events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__ENV__;
  reportBackendReachable();
});

describe('useBackendHints', () => {
  it('subscribes the org stream and invalidates the entity prefix on a hint', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useBackendHints('org1'), { wrapper });

    const source = FakeEventSource.instances[0];
    expect(source?.url).toBe('/events?orgId=org1');
    expect(source?.withCredentials).toBe(true);

    act(() => {
      source?.emit('hint', JSON.stringify({ entity: 'task', entityId: 't1' }));
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['backend', 'org1', 'task'],
    });
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

  it('keeps the backend reachable when EventSource errors', () => {
    expect(isBackendReachable()).toBe(true);
    renderHook(() => useBackendHints('org1'), { wrapper });
    act(() => {
      FakeEventSource.instances[0]?.emit('error', '');
    });
    expect(isBackendReachable()).toBe(true);
  });

  it('opens nothing without an org scope', () => {
    renderHook(() => useBackendHints(undefined), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
