import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { act, render, screen } from '@/test/utils/render';

const connectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
};

vi.mock('@/app/hooks/use-convex-connection-state', () => ({
  useConvexConnectionState: () => connectionState,
}));

const { OnlineGate } = await import('./online-gate');

describe('OnlineGate', () => {
  function resetState() {
    connectionState.isWebSocketConnected = true;
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  }

  it('renders children when online', () => {
    resetState();
    render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    expect(screen.getByText('Hello')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows offline overlay when navigator goes offline', () => {
    resetState();
    render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event('offline'));
    });

    const overlay = screen.getByRole('alertdialog');
    expect(overlay).toBeVisible();
    expect(overlay).toHaveAttribute('aria-modal', 'true');
    expect(overlay).toHaveAttribute('aria-live', 'polite');
  });

  it('clears the overlay when navigator comes back online', () => {
    resetState();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    render(
      <OnlineGate>
        <p>Hello</p>
      </OnlineGate>,
    );
    expect(screen.getByRole('alertdialog')).toBeVisible();

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  describe('accessibility', () => {
    it('passes axe audit while online', async () => {
      resetState();
      const { container } = render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit while offline', async () => {
      resetState();
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      const { container } = render(
        <OnlineGate>
          <p>Hello</p>
        </OnlineGate>,
      );
      await checkAccessibility(container);
    });
  });
});
