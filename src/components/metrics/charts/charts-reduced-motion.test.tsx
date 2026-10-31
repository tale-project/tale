import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DonutChart } from './donut-chart';
import { TrendAreaChart } from './trend-area-chart';
import { TrendBarChart } from './trend-bar-chart';
import { TrendLineChart } from './trend-line-chart';

// Recharts lays nothing out in jsdom, so stand in for its pieces and record
// what each series element is told about its entry animation.
const recorded = vi.hoisted(() => ({ animation: [] as unknown[] }));

vi.mock('recharts', () => {
  const none = () => null;
  const pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const series = ({ isAnimationActive }: { isAnimationActive?: unknown }) => {
    recorded.animation.push(isAnimationActive);
    return null;
  };
  return {
    ResponsiveContainer: pass,
    BarChart: pass,
    AreaChart: pass,
    LineChart: pass,
    PieChart: pass,
    CartesianGrid: none,
    XAxis: none,
    YAxis: none,
    Tooltip: none,
    Cell: none,
    Bar: series,
    Area: series,
    Line: series,
    Pie: series,
  };
});

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: reduce && query === REDUCED_MOTION,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

const DATA = [{ day: '2026-09-29', tokens: 448 }];
const SERIES = [{ key: 'tokens', label: 'Tokens', color: '#000' }];

function renderEveryChart() {
  render(
    <>
      <TrendBarChart data={DATA} series={SERIES} xKey="day" />
      <TrendAreaChart data={DATA} series={SERIES} xKey="day" />
      <TrendLineChart data={DATA} series={SERIES} xKey="day" />
      <DonutChart
        segments={[{ key: 'ok', label: 'Successful', value: 7, color: '#000' }]}
      />
    </>,
  );
}

describe('metrics charts under reduced motion', () => {
  afterEach(() => {
    recorded.animation = [];
  });

  it('animates every series by default', () => {
    setReducedMotion(false);
    renderEveryChart();
    expect(recorded.animation).toEqual([true, true, true, true]);
  });

  it('shows the final figures at once for a reader who reduces motion', () => {
    setReducedMotion(true);
    renderEveryChart();
    expect(recorded.animation).toEqual([false, false, false, false]);
  });
});
