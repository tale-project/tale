import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { computeTrend, TrendIndicator } from './trend-indicator';

describe('computeTrend', () => {
  it('computes a positive percentage for an increase', () => {
    expect(computeTrend(120, 100)).toEqual({
      deltaPct: 20,
      direction: 'up',
      isComputable: true,
    });
  });

  it('computes a negative percentage for a decrease', () => {
    expect(computeTrend(80, 100)).toEqual({
      deltaPct: -20,
      direction: 'down',
      isComputable: true,
    });
  });

  it('reports a flat, computable trend for an unchanged value', () => {
    expect(computeTrend(100, 100)).toEqual({
      deltaPct: 0,
      direction: 'flat',
      isComputable: true,
    });
  });

  it('treats 0 → 0 as flat and computable', () => {
    expect(computeTrend(0, 0)).toEqual({
      deltaPct: 0,
      direction: 'flat',
      isComputable: true,
    });
  });

  it('treats 0 → n as upward but NOT computable (no finite percentage)', () => {
    expect(computeTrend(5, 0)).toEqual({
      deltaPct: null,
      direction: 'up',
      isComputable: false,
    });
  });

  it('treats a missing previous value as not computable', () => {
    expect(computeTrend(5, undefined)).toEqual({
      deltaPct: null,
      direction: 'flat',
      isComputable: false,
    });
    expect(computeTrend(5, null)).toEqual({
      deltaPct: null,
      direction: 'flat',
      isComputable: false,
    });
  });
});

describe('TrendIndicator', () => {
  describe('rendering', () => {
    it('renders the percentage and comparison label', () => {
      render(
        <TrendIndicator
          value={120}
          previous={100}
          comparisonLabel="vs prior"
        />,
      );
      expect(screen.getByText('+20%')).toBeInTheDocument();
      expect(screen.getByText('vs prior')).toBeInTheDocument();
    });

    it('colors a normal increase as positive (success)', () => {
      const { container } = render(
        <TrendIndicator value={120} previous={100} />,
      );
      expect(
        container.querySelector('.text-chart-success'),
      ).toBeInTheDocument();
    });

    it('flips sentiment color when inverted (an increase is bad)', () => {
      const { container } = render(
        <TrendIndicator value={120} previous={100} inverted />,
      );
      expect(
        container.querySelector('.text-chart-failure'),
      ).toBeInTheDocument();
    });

    it('renders a neutral dash when there is no prior data', () => {
      const { container } = render(<TrendIndicator value={12} previous={0} />);
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(
        container.querySelector('.text-muted-foreground'),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <TrendIndicator
          value={120}
          previous={100}
          comparisonLabel="vs prior"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
