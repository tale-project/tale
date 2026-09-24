import type { Meta, StoryObj } from '@storybook/react';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';

import { DonutChart } from './donut-chart';
import { TrendAreaChart } from './trend-area-chart';
import { TrendBarChart } from './trend-bar-chart';
import { TrendLineChart } from './trend-line-chart';
import { seriesToLegend, segmentsToLegend, type ChartSeries } from './types';

/**
 * The generic chart family — thin recharts wrappers on shared chart-theme
 * tokens, designed to live inside a `<ChartCard>`. These render the chart BODY
 * only; the card supplies the title/legend/loading/empty chrome.
 */
const meta: Meta = {
  title: 'Metrics/Charts',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

const shortDay = (key: string) => key.slice(5); // 2026-06-12 → 06-12

const trendData = [
  { day: '2026-06-10', completed: 24, failed: 2 },
  { day: '2026-06-11', completed: 31, failed: 1 },
  { day: '2026-06-12', completed: 18, failed: 4 },
  { day: '2026-06-13', completed: 40, failed: 3 },
  { day: '2026-06-14', completed: 36, failed: 0 },
];

const runSeries: ChartSeries[] = [
  {
    key: 'completed',
    label: 'Completed',
    color: CHART_COLORS.success,
    stackId: 'runs',
  },
  {
    key: 'failed',
    label: 'Failed',
    color: CHART_COLORS.failure,
    stackId: 'runs',
  },
];

export const StackedBar: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ChartCard
        title="Execution trend"
        tooltip="Completed vs failed runs per day."
        legend={<ChartLegend items={seriesToLegend(runSeries)} />}
      >
        <TrendBarChart
          data={trendData}
          series={runSeries}
          xKey="day"
          xTickFormatter={shortDay}
        />
      </ChartCard>
    </div>
  ),
};

export const Line: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ChartCard title="Cycle time">
        <TrendLineChart
          data={trendData.map((d) => ({ day: d.day, hours: d.completed / 4 }))}
          series={[
            { key: 'hours', label: 'Avg hours', color: CHART_COLORS.primary },
          ]}
          xKey="day"
          xTickFormatter={shortDay}
          valueFormatter={(v) => `${v.toFixed(1)}h`}
        />
      </ChartCard>
    </div>
  ),
};

export const StackedArea: Story = {
  render: () => {
    const flow: ChartSeries[] = [
      { key: 'backlog', label: 'Backlog', color: CHART_COLORS.neutral },
      { key: 'inProgress', label: 'In progress', color: CHART_COLORS.primary },
      { key: 'done', label: 'Done', color: CHART_COLORS.success },
    ];
    const data = trendData.map((d, i) => ({
      day: d.day,
      backlog: 20 - i * 2,
      inProgress: 5 + i,
      done: d.completed,
    }));
    return (
      <div className="max-w-2xl">
        <ChartCard
          title="Cumulative flow"
          legend={<ChartLegend items={seriesToLegend(flow)} />}
        >
          <TrendAreaChart
            data={data}
            series={flow}
            xKey="day"
            xTickFormatter={shortDay}
          />
        </ChartCard>
      </div>
    );
  },
};

export const Donut: Story = {
  render: () => {
    const segments = [
      {
        key: 'completed',
        label: 'Completed',
        value: 149,
        color: CHART_COLORS.success,
      },
      {
        key: 'failed',
        label: 'Failed',
        value: 10,
        color: CHART_COLORS.failure,
      },
      {
        key: 'running',
        label: 'Running',
        value: 6,
        color: CHART_COLORS.neutral,
      },
    ];
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    return (
      <div className="max-w-md">
        <ChartCard
          title="Status breakdown"
          bodyClassName="h-52"
          legend={<ChartLegend items={segmentsToLegend(segments)} />}
        >
          <DonutChart
            segments={segments}
            centerValue={total}
            centerLabel="Total"
          />
        </ChartCard>
      </div>
    );
  },
};
