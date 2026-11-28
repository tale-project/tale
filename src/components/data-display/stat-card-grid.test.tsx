import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Skeletonize } from '../feedback/skeleton-context';
import { StatCard, StatCardGrid } from './stat-card-grid';

// The grid inside the `@container` wrapper.
function stripOf(container: HTMLElement): Element | null {
  return container.firstElementChild?.firstElementChild ?? null;
}

describe('StatCardGrid', () => {
  describe('rendering', () => {
    it('renders label and value', () => {
      render(
        <StatCardGrid>
          <StatCard label="Requests" value="42" />
        </StatCardGrid>,
      );
      expect(screen.getByText('Requests')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('defaults to a 4-column strip and applies className', () => {
      const { container } = render(
        <StatCardGrid className="custom-class">
          <StatCard label="A" value="1" />
        </StatCardGrid>,
      );
      // The strip answers to its own width: an `@container` wrapper around
      // the grid, which goes four across from 36rem.
      expect(container.firstChild).toHaveClass('@container');
      expect(stripOf(container)).toHaveClass(
        'grid-cols-2',
        '@xl:grid-cols-4',
        'gap-px',
        'custom-class',
      );
    });

    it('paints cell backgrounds so gap-px dividers show through', () => {
      const { container } = render(
        <StatCardGrid>
          <StatCard label="A" value="1" />
        </StatCardGrid>,
      );
      expect(stripOf(container)).toHaveClass('bg-border-base');
      expect(container.querySelector('.bg-bg-base')).toBeInTheDocument();
    });

    it('applies cols=2', () => {
      const { container } = render(
        <StatCardGrid cols={2}>
          <StatCard label="A" value="1" />
        </StatCardGrid>,
      );
      expect(stripOf(container)).toHaveClass('grid-cols-2');
    });

    it('applies cols=3 as a single column until the strip is 28rem wide', () => {
      const { container } = render(
        <StatCardGrid cols={3}>
          <StatCard label="A" value="1" />
        </StatCardGrid>,
      );
      expect(stripOf(container)).toHaveClass('grid-cols-1', '@md:grid-cols-3');
    });

    it('spans both columns for colSpan=2', () => {
      const { container } = render(
        <StatCardGrid>
          <StatCard label="Wide" value="x" colSpan={2} />
        </StatCardGrid>,
      );
      expect(container.querySelector('.col-span-2')).toBeInTheDocument();
    });

    it('masks the value while loading', () => {
      render(
        <Skeletonize loading>
          <StatCardGrid>
            <StatCard label="Requests" value="42" />
          </StatCardGrid>
        </Skeletonize>,
      );
      // Label still renders; the numeric value is masked by the skeleton box.
      expect(screen.getByText('Requests')).toBeInTheDocument();
      expect(screen.getByText('42')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <StatCardGrid>
          <StatCard label="Revenue" value="$12,400" />
          <StatCard label="Orders" value="342" />
        </StatCardGrid>,
      );
      await checkAccessibility(container);
    });
  });
});
