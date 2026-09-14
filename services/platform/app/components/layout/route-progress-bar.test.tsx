import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { RouteProgressBar } from './route-progress-bar';

const navigation = vi.hoisted(() => ({ status: 'idle' }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouterState: ({
    select,
  }: {
    select: (state: typeof navigation) => unknown;
  }) => select(navigation),
}));

describe('RouteProgressBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.status = 'idle';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders no progressbar while navigation is idle', () => {
    render(<RouteProgressBar />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('never flashes for a quick navigation or after it completes', () => {
    const { rerender } = render(<RouteProgressBar />);

    navigation.status = 'pending';
    rerender(<RouteProgressBar />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    navigation.status = 'idle';
    rerender(<RouteProgressBar />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('labels a slow navigation and hides progress immediately when it ends', () => {
    navigation.status = 'pending';
    const { rerender } = render(<RouteProgressBar />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(
      screen.getByRole('progressbar', { name: 'Loading page' }),
    ).toHaveAttribute('aria-busy', 'true');

    navigation.status = 'idle';
    rerender(<RouteProgressBar />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('starts a fresh delay after both cancelled and visible navigations', () => {
    const { rerender } = render(<RouteProgressBar />);

    for (const duration of [100, 200]) {
      navigation.status = 'pending';
      rerender(<RouteProgressBar />);
      act(() => {
        vi.advanceTimersByTime(duration);
      });
      navigation.status = 'idle';
      rerender(<RouteProgressBar />);

      navigation.status = 'pending';
      rerender(<RouteProgressBar />);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      navigation.status = 'idle';
      rerender(<RouteProgressBar />);
    }
  });

  it('cancels the pending reveal on unmount', () => {
    navigation.status = 'pending';
    const { unmount } = render(<RouteProgressBar />);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  describe('accessibility', () => {
    it('passes axe audit while idle', async () => {
      vi.useRealTimers();
      const { container } = render(<RouteProgressBar />);
      await checkAccessibility(container);
    });

    it('passes axe audit while pending', async () => {
      navigation.status = 'pending';
      const { container } = render(<RouteProgressBar />);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      vi.useRealTimers();
      await checkAccessibility(container);
    });
  });
});
