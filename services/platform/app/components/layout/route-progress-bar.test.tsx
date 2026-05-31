import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

// Drive the bar purely off the router status. The mock runs the component's
// real `select` against a fake router state so we exercise the select logic too.
let routerStatus: 'idle' | 'pending' = 'idle';
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { status: string }) => unknown;
  }) => select({ status: routerStatus }),
}));

import { RouteProgressBar } from './route-progress-bar';

afterEach(() => {
  routerStatus = 'idle';
});

describe('RouteProgressBar', () => {
  it('renders no progressbar while navigation is idle', () => {
    routerStatus = 'idle';
    render(<RouteProgressBar />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders a labelled progressbar while a route transition is pending', () => {
    routerStatus = 'pending';
    render(<RouteProgressBar />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-busy', 'true');
    expect(bar).toHaveAccessibleName();
  });

  describe('accessibility', () => {
    it('passes axe audit while idle', async () => {
      routerStatus = 'idle';
      const { container } = render(<RouteProgressBar />);
      await checkAccessibility(container);
    });

    it('passes axe audit while pending', async () => {
      routerStatus = 'pending';
      const { container } = render(<RouteProgressBar />);
      await checkAccessibility(container);
    });
  });
});
