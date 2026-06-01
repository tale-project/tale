import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { SkeletonBox, SkeletonCircle, SkeletonText } from './skeleton';
import { Skeletonize } from './skeleton-context';

describe('SkeletonBox', () => {
  it('renders the real child untouched when not loading', () => {
    render(
      <SkeletonBox>
        <span data-testid="value">42</span>
      </SkeletonBox>,
    );
    expect(screen.getByTestId('value')).toHaveTextContent('42');
  });

  it('adds no box of its own when not loading (display: contents)', () => {
    const { container } = render(
      <SkeletonBox>
        <span data-testid="value">42</span>
      </SkeletonBox>,
    );
    expect(container.firstElementChild).toHaveClass('contents');
  });

  it('keeps the child mounted and hides the region while loading', () => {
    render(
      <Skeletonize loading>
        <SkeletonBox>
          <span data-testid="value">42</span>
        </SkeletonBox>
      </Skeletonize>,
    );
    // The real content stays in the tree (so the mask sizes to it) but is
    // visibility-hidden behind the opaque overlay — it can't peek through.
    const value = screen.getByTestId('value');
    expect(value).toBeInTheDocument();
    expect(value.parentElement).toHaveClass('invisible', 'contents');
  });
});

describe('SkeletonCircle', () => {
  it('wraps round content and is decorative while loading', () => {
    render(
      <Skeletonize loading>
        <SkeletonCircle>
          <span data-testid="avatar" className="block size-9" />
        </SkeletonCircle>
      </Skeletonize>,
    );
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });
});

describe('SkeletonText', () => {
  it('renders a single line by default', () => {
    const { container } = render(<SkeletonText />);
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('renders `lines` lines', () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it('is decorative (aria-hidden)', () => {
    const { container } = render(<SkeletonText lines={2} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes axe audit', async () => {
    const { container } = render(<SkeletonText lines={3} />);
    await checkAccessibility(container);
  });
});
