import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Skeletonize } from '../feedback/skeleton-context';
import { StatCard, StatCardGrid } from './stat-card-grid';

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
      expect(container.firstChild).toHaveClass(
        'md:grid-cols-4',
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
      expect(container.firstChild).toHaveClass('bg-border-base');
      expect(container.querySelector('.bg-bg-base')).toBeInTheDocument();
    });

    it('applies cols=2', () => {
      const { container } = render(
        <StatCardGrid cols={2}>
          <StatCard label="A" value="1" />
        </StatCardGrid>,
      );
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
    });

    it('applies cols=3 as a single column on mobile', () => {
      const { container } = render(
        <StatCardGrid cols={3}>
          <StatCard label="A" value="1" />
        </StatCardGrid>,
      );
      expect(container.firstChild).toHaveClass('grid-cols-1', 'md:grid-cols-3');
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
      expect(screen.queryByText('42')).not.toBeInTheDocument();
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
