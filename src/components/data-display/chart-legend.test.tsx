import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ChartLegend } from './chart-legend';

describe('ChartLegend', () => {
  describe('rendering', () => {
    it('renders a row per item with its label', () => {
      render(
        <ChartLegend
          items={[
            { label: 'Completed', color: 'var(--color-chart-success)' },
            { label: 'Failed', color: 'var(--color-chart-failure)' },
          ]}
        />,
      );
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('renders optional trailing values', () => {
      render(
        <ChartLegend
          items={[
            {
              label: 'Completed',
              color: 'var(--color-chart-success)',
              value: '1,284',
            },
          ]}
        />,
      );
      expect(screen.getByText('1,284')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ChartLegend
          items={[
            { label: 'Completed', color: 'var(--color-chart-success)' },
            { label: 'Failed', color: 'var(--color-chart-failure)' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
