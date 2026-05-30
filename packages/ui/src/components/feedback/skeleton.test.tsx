import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Skeleton, SkeletonBox, SkeletonText } from './skeleton';

describe('Skeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Skeleton />);
      await checkAccessibility(container);
    });

    it('has status role', () => {
      render(<Skeleton />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has accessible label', () => {
      render(<Skeleton label="Loading users" />);
      expect(screen.getByLabelText('Loading users')).toBeInTheDocument();
    });

    it('has sr-only text', () => {
      render(<Skeleton label="Loading data" />);
      expect(screen.getByText('Loading data')).toBeInTheDocument();
    });
  });
});

describe('SkeletonBox', () => {
  it('is decorative (aria-hidden) so it does not double-announce', () => {
    const { container } = render(<SkeletonBox />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies caller sizing classes', () => {
    const { container } = render(<SkeletonBox className="h-10 w-8" />);
    expect(container.firstElementChild).toHaveClass('h-10', 'w-8');
  });

  it('honors an explicit style height', () => {
    const { container } = render(<SkeletonBox style={{ height: 112 }} />);
    expect(container.firstElementChild).toHaveStyle({ height: '112px' });
  });
});

describe('SkeletonText', () => {
  it('renders a single bar by default', () => {
    const { container } = render(<SkeletonText />);
    // one wrapper > one bar
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('renders `lines` bars', () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it('is decorative (aria-hidden)', () => {
    const { container } = render(<SkeletonText lines={2} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
