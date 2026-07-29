import type { Meta, StoryObj } from '@storybook/react';
import { Alert } from '@tale/ui/alert';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { AlertTriangle } from 'lucide-react';

import { Select } from '@/app/components/ui/forms/select';

import { TrendBarChart } from './charts';
import { MetricsFilterChips } from './metrics-filter-chips';
import { MetricsLayout } from './metrics-layout';
import { MetricsSection } from './metrics-section';

/**
 * The canonical metrics-page anatomy: header (title + description + toolbar) →
 * filter chips → notices → KPI row → chart(s) → titled sections (tables).
 * Every metrics surface renders this same shell; non-chart bodies sit in a
 * `MetricsSection` so the section headings match everywhere.
 */
const meta: Meta<typeof MetricsLayout> = {
  title: 'Metrics/MetricsLayout',
  component: MetricsLayout,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof MetricsLayout>;

const trend = [
  { day: '2026-06-10', completed: 24, failed: 2 },
  { day: '2026-06-11', completed: 31, failed: 1 },
  { day: '2026-06-12', completed: 18, failed: 4 },
  { day: '2026-06-13', completed: 40, failed: 3 },
  { day: '2026-06-14', completed: 36, failed: 0 },
];
const series = [
  {
    key: 'completed',
    label: 'Completed',
    color: CHART_COLORS.success,
    stackId: 'r',
  },
  { key: 'failed', label: 'Failed', color: CHART_COLORS.failure, stackId: 'r' },
];

export const FullAnatomy: Story = {
  render: () => (
    <MetricsLayout
      title="Automation metrics"
      description="Automation run health for the selected period."
      toolbar={
        <div className="w-36">
          <Select
            aria-label="Period"
            value="30"
            onValueChange={() => {}}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
          />
        </div>
      }
      notice={
        <Alert
          variant="warning"
          icon={AlertTriangle}
          title="Showing a partial sample"
          description="Results are capped; counts are lower bounds."
        />
      }
    >
      <StatCardGrid>
        <StatCard label="Total runs" value="1,284">
          <div className="mt-0.5">
            <TrendIndicator value={1284} previous={1100} />
          </div>
        </StatCard>
        <StatCard label="Success rate" value="98.6%">
          <div className="mt-0.5">
            <TrendIndicator value={98.6} previous={97.1} />
          </div>
        </StatCard>
        <StatCard label="Avg duration" value="1.4s">
          <div className="mt-0.5">
            <TrendIndicator value={1.4} previous={1.9} inverted />
          </div>
        </StatCard>
        <StatCard label="Failed runs" value="36">
          <div className="mt-0.5">
            <TrendIndicator value={36} previous={58} inverted />
          </div>
        </StatCard>
      </StatCardGrid>

      <ChartCard
        title="Execution trend"
        legend={
          <ChartLegend
            items={series.map((s) => ({ label: s.label, color: s.color }))}
          />
        }
      >
        <TrendBarChart
          data={trend}
          series={series}
          xKey="day"
          xTickFormatter={(d) => d.slice(5)}
        />
      </ChartCard>

      <MetricsSection title="Top automations">
        <div className="border-border text-muted-foreground flex h-32 items-center justify-center rounded-lg border border-dashed text-sm">
          DataTable
        </div>
      </MetricsSection>
    </MetricsLayout>
  ),
};

export const WithFilters: Story = {
  render: () => (
    <MetricsLayout
      title="Usage"
      description="LLM requests, tokens, and cost."
      as="h3"
      toolbar={
        <div className="w-36">
          <Select
            aria-label="Period"
            value="30"
            onValueChange={() => {}}
            options={[{ value: '30', label: 'Last 30 days' }]}
          />
        </div>
      }
      filters={
        <MetricsFilterChips
          clearAllLabel="Clear all"
          onClearAll={() => {}}
          chips={[
            { key: 'agent', label: 'Agent: support-bot', onClear: () => {} },
            {
              key: 'model',
              label: 'Model: claude-opus-4-8',
              onClear: () => {},
            },
          ]}
        />
      }
    >
      <StatCardGrid>
        <StatCard label="Requests" value="12,480" />
        <StatCard label="Tokens" value="3.2M" />
        <StatCard label="Cost" value="$184.20" />
        <StatCard label="Active users" value="312" />
      </StatCardGrid>
    </MetricsLayout>
  ),
};
