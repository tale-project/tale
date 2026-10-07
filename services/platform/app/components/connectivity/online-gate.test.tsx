import { QueryClient, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen } from '@/tests/utils/render';

const connectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
};

/**
 * Most cases script the connection state directly; the probe cases flip
 * this to run the REAL hook (`connection-state.ts` with a mocked `fetch`),
 * so they prove the whole lane from the `offline` event to the overlay.
 */
let useRealConnectionState = false;
const realConnectionState = await vi.importActual<
  typeof import('@/app/hooks/use-backend-connection-state')
>('@/app/hooks/use-backend-connection-state');

vi.mock('@/app/hooks/use-backend-connection-state', () => ({
  useBackendConnectionState: () =>
    useRealConnectionState
      ? realConnectionState.useBackendConnectionState()
      : connectionState,
}));

const { OnlineGate } = await import('./online-gate');
const { reportBackendReachable } =
  await import('@/app/lib/backend/connection-state');
const { backendFetch } = await import('@/app/lib/backend/api-client');

// Matches the grace window in online-gate.tsx; bumped a few ms here to
// dodge timer-rounding flakiness across vitest's fake-timer backends.
const GRACE_MS = 3_100;

describe('OnlineGate', () => {
  beforeEach(() => {
    connectionState.isWebSocketConnected = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useRealConnectionState = false;
    reportBackendReachable();
    delete window.__ENV__;
  });

  it('renders children when Convex is connected', () => {
    render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    expect(screen.getByText('Hello')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not show the overlay before the grace window elapses', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    connectionState.isWebSocketConnected = false;
    rerender(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    act(() => {
      vi.advanceTimersByTime(GRACE_MS - 500);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the overlay after Convex stays disconnected past the grace window', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    connectionState.isWebSocketConnected = false;
    rerender(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    act(() => {
      vi.advanceTimersByTime(GRACE_MS);
    });
    const overlay = screen.getByRole('alertdialog');
    expect(overlay).toBeVisible();
    expect(overlay).toHaveAttribute('aria-modal', 'true');
    expect(overlay).toHaveAttribute('aria-live', 'polite');
  });

  it('clears the overlay when Convex reconnects', () => {
    vi.useFakeTimers();
    connectionState.isWebSocketConnected = false;
    const { rerender } = render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    act(() => {
      vi.advanceTimersByTime(GRACE_MS);
    });
    expect(screen.getByRole('alertdialog')).toBeVisible();

    connectionState.isWebSocketConnected = true;
    rerender(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('reloads the document when "Try again" is pressed', () => {
    // A full reload, not a client-side nudge: the states that strand a user
    // on this overlay (stale build, rejected ws auth token, backend moved)
    // are exactly the ones Convex's own auto-reconnect cannot retry out of.
    // jsdom's `Location.reload` is non-configurable and throws "Not
    // implemented: navigation", so replace the whole object and restore it.
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: original.href, origin: original.origin, reload },
    });
    try {
      vi.useFakeTimers();
      connectionState.isWebSocketConnected = false;
      render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      act(() => {
        vi.advanceTimersByTime(GRACE_MS);
      });

      const retry = screen.getByRole('button', { name: 'Try again' });
      act(() => {
        retry.click();
      });

      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    }
  });

  describe('backend probe', () => {
    // The device going offline is not the verdict — the `/api/health` probe
    // it triggers is. A probe that never gets a response shows the overlay;
    // one that answers (a backend on localhost while the WAN is down, the
    // common `bun run dev` shape) keeps it hidden.
    function goOffline(): void {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event('offline'));
    }

    afterEach(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
    });

    it("shows the overlay when the offline event's probe gets no response", async () => {
      useRealConnectionState = true;
      window.__ENV__ = { BASE_PATH: '' };
      const fetchMock = vi
        .spyOn(window, 'fetch')
        .mockRejectedValue(new TypeError('Failed to fetch'));
      vi.useFakeTimers();
      render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      expect(screen.queryByRole('alertdialog')).toBeNull();

      await act(async () => {
        goOffline();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/health/ready',
        expect.objectContaining({ cache: 'no-store' }),
      );
      act(() => {
        vi.advanceTimersByTime(GRACE_MS);
      });
      const overlay = screen.getByRole('alertdialog');
      expect(overlay).toBeVisible();
      expect(overlay).toHaveTextContent("You're offline");
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('keeps the overlay hidden when the probe answers although the device reports offline', async () => {
      useRealConnectionState = true;
      window.__ENV__ = { BASE_PATH: '' };
      const fetchMock = vi
        .spyOn(window, 'fetch')
        .mockImplementation(async () =>
          Response.json({ ok: true, service: 'backend' }),
        );
      vi.useFakeTimers();
      render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      await act(async () => {
        goOffline();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(GRACE_MS);
      });
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  describe('cancelled reads', () => {
    // Leaving a page unmounts its queries, and TanStack Query aborts every
    // read still in flight. Under a slow network that is most reads, and none
    // of them says anything about the server.
    it('keeps the overlay hidden when a navigation cancels in-flight reads', async () => {
      useRealConnectionState = true;
      window.__ENV__ = { BASE_PATH: '' };
      const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason);
            });
          }),
      );
      vi.useFakeTimers();
      const queryClient = new QueryClient();
      function ChatPage() {
        useQuery(
          {
            queryKey: ['chat-threads'],
            queryFn: ({ signal }) =>
              backendFetch('/chat/threads', { orgId: 'org1', signal }),
          },
          queryClient,
        );
        return <p>Chat</p>;
      }
      const { rerender } = render(
        <OnlineGate>
          <ChatPage />
        </OnlineGate>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Navigating away unmounts the page: TanStack Query aborts its read.
      rerender(
        <OnlineGate>
          <p>Documents</p>
        </OnlineGate>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      act(() => {
        vi.advanceTimersByTime(GRACE_MS);
      });
      expect(screen.queryByRole('alertdialog')).toBeNull();
      queryClient.clear();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit while connected', async () => {
      const { container } = render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit while the overlay is visible', async () => {
      vi.useFakeTimers();
      connectionState.isWebSocketConnected = false;
      const { container } = render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      act(() => {
        vi.advanceTimersByTime(GRACE_MS);
      });
      vi.useRealTimers();
      await checkAccessibility(container);
    });
  });
});
