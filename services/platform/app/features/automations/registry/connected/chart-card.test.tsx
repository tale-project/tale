// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChartRow, ChartSeries } from '@/app/components/metrics/charts';

import type { BoundQueryResult } from '../../hooks/use-bound-query';
import { ChartCard } from './chart-card';

// i18n → echo `automations.<key>`.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`,
  }),
}));

// The recharts wrappers → prop-capturing stubs (their rendering is covered by
// their own suites; this block owns the row/series mapping fed into them).
interface CapturedChart {
  kind: 'line' | 'bar' | 'area';
  data: ChartRow[];
  series: readonly ChartSeries[];
  xKey: string;
}
let captured: CapturedChart | undefined;
vi.mock('@/app/components/metrics/charts', () => {
  const capture =
    (kind: CapturedChart['kind']) =>
    ({
      data,
      series,
      xKey,
    }: {
      data: ChartRow[];
      series: readonly ChartSeries[];
      xKey: string;
    }) => {
      captured = { kind, data, series, xKey };
      return <div data-testid={`chart-${kind}`} />;
    };
  return {
    TrendLineChart: capture('line'),
    TrendBarChart: capture('bar'),
    TrendAreaChart: capture('area'),
    seriesToLegend: (series: readonly ChartSeries[]) =>
      series.map((s) => ({ label: s.label, color: s.color })),
  };
});

let queryReturn: BoundQueryResult;
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => queryReturn,
}));

function bound(over: Partial<BoundQueryResult>): BoundQueryResult {
  return {
    data: undefined,
    isLoading: false,
    error: undefined,
    blocked: false,
    needsConfig: false,
    ...over,
  };
}

const QUERY = { path: 'task_metrics/queries:getProjectTaskMetrics', args: {} };
const CHART = {
  kind: 'line' as const,
  xField: 'dateKey',
  series: [{ field: 'tasksCompleted', labelKey: 'Completed' }],
};

afterEach(() => {
  captured = undefined;
});

describe('ChartCard — data mapping', () => {
  it('extracts rows via a dot-notation itemsKey and flattens onto safe keys', () => {
    queryReturn = bound({
      data: {
        metrics: {
          daily: [
            { dateKey: '2026-01', tasksCompleted: 1 },
            { dateKey: '2026-02', tasksCompleted: 2 },
          ],
        },
      },
    });

    render(
      <ChartCard
        titleKey="Chart title"
        query={QUERY}
        itemsKey="metrics.daily"
        chart={CHART}
      />,
    );

    expect(screen.getByTestId('chart-line')).toBeInTheDocument();
    expect(captured?.xKey).toBe('x');
    expect(captured?.data).toEqual([
      { x: '2026-01', s0: 1 },
      { x: '2026-02', s0: 2 },
    ]);
    expect(captured?.series).toEqual([
      {
        key: 's0',
        label: 'Completed',
        color: expect.stringContaining('var(--color-chart-'),
      },
    ]);
    expect(screen.getByText('Chart title')).toBeInTheDocument();
  });

  it('uses the result itself when it already is the row array', () => {
    queryReturn = bound({
      data: [{ dateKey: 'd1', tasksCompleted: 5 }],
    });

    render(<ChartCard titleKey="T" query={QUERY} chart={CHART} />);

    expect(captured?.data).toEqual([{ x: 'd1', s0: 5 }]);
  });

  it('gaps non-numeric series values as null instead of crashing', () => {
    queryReturn = bound({
      data: [
        { dateKey: 'd1', tasksCompleted: 'oops' },
        { dateKey: 'd2', tasksCompleted: 2 },
      ],
    });

    render(<ChartCard titleKey="T" query={QUERY} chart={CHART} />);

    expect(captured?.data).toEqual([
      { x: 'd1', s0: null },
      { x: 'd2', s0: 2 },
    ]);
  });

  it('picks the wrapper matching chart.kind', () => {
    queryReturn = bound({ data: [{ dateKey: 'd1', tasksCompleted: 1 }] });

    render(
      <ChartCard
        titleKey="T"
        query={QUERY}
        chart={{ ...CHART, kind: 'bar' }}
      />,
    );

    expect(screen.getByTestId('chart-bar')).toBeInTheDocument();
  });

  it('renders a legend only for multi-series charts', () => {
    queryReturn = bound({
      data: [{ dateKey: 'd1', a: 1, b: 2 }],
    });

    render(
      <ChartCard
        titleKey="T"
        query={QUERY}
        chart={{
          kind: 'area',
          xField: 'dateKey',
          series: [
            { field: 'a', labelKey: 'Series A' },
            { field: 'b', labelKey: 'Series B' },
          ],
        }}
      />,
    );

    expect(screen.getByText('Series A')).toBeInTheDocument();
    expect(screen.getByText('Series B')).toBeInTheDocument();
  });
});

describe('ChartCard — states', () => {
  it('maps isLoading onto the ChartCard loading placeholder', () => {
    queryReturn = bound({ isLoading: true });

    render(<ChartCard titleKey="T" query={QUERY} chart={CHART} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-line')).not.toBeInTheDocument();
  });

  it('shows the shared empty copy when the query returns no rows — never the title twice', () => {
    queryReturn = bound({ data: [] });

    render(<ChartCard titleKey="Empty chart" query={QUERY} chart={CHART} />);

    // The title renders EXACTLY once (the card header); the empty state
    // carries the shared binding copy instead of repeating the title (a
    // duplicate heading is both noisy UI and a strict-mode locator trap).
    expect(screen.getAllByText('Empty chart')).toHaveLength(1);
    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-line')).not.toBeInTheDocument();
  });

  it('surfaces the blocked state inside the card body', () => {
    queryReturn = bound({ blocked: true });

    render(<ChartCard titleKey="T" query={QUERY} chart={CHART} />);

    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
  });

  it('reads an unresolved $state binding as awaiting selection', () => {
    queryReturn = bound({ needsConfig: true });

    render(
      <ChartCard
        titleKey="T"
        query={{ path: QUERY.path, args: { taskId: '$state.taskId' } }}
        chart={CHART}
      />,
    );

    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
  });
});
