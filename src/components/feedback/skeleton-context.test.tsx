import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Skeletonize, useSkeleton } from './skeleton-context';

function Probe() {
  const loading = useSkeleton();
  return <span data-testid="probe">{loading ? 'loading' : 'ready'}</span>;
}

describe('Skeletonize / useSkeleton', () => {
  it('defaults to not-loading outside any provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('ready');
  });

  it('provides loading=true to descendants while loading', () => {
    render(
      <Skeletonize loading>
        <Probe />
      </Skeletonize>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('loading');
  });

  it('provides loading=false when not loading', () => {
    render(
      <Skeletonize loading={false}>
        <Probe />
      </Skeletonize>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('ready');
  });

  it('renders the SAME children in both states (single tree, no drift)', () => {
    const { rerender } = render(
      <Skeletonize loading>
        <span data-testid="child">content</span>
      </Skeletonize>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    rerender(
      <Skeletonize loading={false}>
        <span data-testid="child">content</span>
      </Skeletonize>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('exposes a single status/aria-busy region while loading', () => {
    render(
      <Skeletonize loading label="Loading thing">
        <span>x</span>
      </Skeletonize>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAccessibleName('Loading thing');
  });

  it('drops the status role / aria-busy when not loading', () => {
    render(
      <Skeletonize loading={false}>
        <span>x</span>
      </Skeletonize>,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('passes axe audit while loading', async () => {
    const { container } = render(
      <Skeletonize loading>
        <button type="button">Save</button>
      </Skeletonize>,
    );
    await checkAccessibility(container);
  });

  it('passes axe audit when not loading', async () => {
    const { container } = render(
      <Skeletonize loading={false}>
        <button type="button">Save</button>
      </Skeletonize>,
    );
    await checkAccessibility(container);
  });
});
