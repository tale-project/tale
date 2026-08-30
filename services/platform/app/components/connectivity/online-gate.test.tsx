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

vi.mock('@/app/hooks/use-backend-connection-state', () => ({
  useBackendConnectionState: () => connectionState,
}));

const { OnlineGate } = await import('./online-gate');

// Matches the grace window in online-gate.tsx; bumped a few ms here to
// dodge timer-rounding flakiness across vitest's fake-timer backends.
const GRACE_MS = 3_100;

describe('OnlineGate', () => {
  beforeEach(() => {
    connectionState.isWebSocketConnected = true;
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('ignores navigator.onLine — Convex on localhost stays reachable even when the device reports offline', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
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
