import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ChartCard } from './chart-card';

describe('ChartCard', () => {
  describe('rendering', () => {
    it('renders the title and children', () => {
      render(
        <ChartCard title="Execution trend">
          <div>chart body</div>
        </ChartCard>,
      );
      expect(screen.getByText('Execution trend')).toBeInTheDocument();
      expect(screen.getByText('chart body')).toBeInTheDocument();
    });

    it('shows a busy placeholder and hides the chart while loading', () => {
      render(
        <ChartCard title="Trend" loading>
          <div>chart body</div>
        </ChartCard>,
      );
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('chart body')).not.toBeInTheDocument();
    });

    it('shows the empty state and hides the chart when empty', () => {
      render(
        <ChartCard title="Trend" isEmpty emptyTitle="No data yet">
          <div>chart body</div>
        </ChartCard>,
      );
      expect(screen.getByText('No data yet')).toBeInTheDocument();
      expect(screen.queryByText('chart body')).not.toBeInTheDocument();
    });

    it('omits the in-card title when the parent owns the section heading', () => {
      render(
        <ChartCard isEmpty emptyTitle="No data yet">
          <div>chart body</div>
        </ChartCard>,
      );
      // EmptyState still has a heading; the card chrome itself has none.
      expect(
        screen.getByRole('heading', { name: 'No data yet' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(screen.queryByText('chart body')).not.toBeInTheDocument();
    });

    it('renders no heading-less empty state when neither title is given', () => {
      render(
        <ChartCard isEmpty>
          <div>chart body</div>
        </ChartCard>,
      );
      // No empty heading available → the body stays blank; an empty state
      // never ships without its announcing heading.
      expect(screen.queryAllByRole('heading')).toHaveLength(0);
      expect(screen.queryByText('chart body')).not.toBeInTheDocument();
    });

    it('renders an info tooltip trigger when given a tooltip', () => {
      render(
        <ChartCard title="Trend" tooltip="What this shows">
          <div>chart body</div>
        </ChartCard>,
      );
      expect(
        screen.getByRole('button', { name: 'What this shows' }),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ChartCard title="Execution trend" tooltip="Runs per day">
          <div>chart body</div>
        </ChartCard>,
      );
      await checkAccessibility(container);
    });
  });
});
