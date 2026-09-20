import type { Meta, StoryObj } from '@storybook/react-vite';
import { BarChart3 } from 'lucide-react';

import { ChartCard } from './chart-card';
import { ChartLegend } from './chart-legend';

const ChartPlaceholder = () => (
  <div className="bg-muted/60 text-muted-foreground flex size-full items-center justify-center rounded-md text-xs">
    chart goes here
  </div>
);

const meta: Meta<typeof ChartCard> = {
  title: 'DataDisplay/ChartCard',
  component: ChartCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
The unified chart container: a bordered card with a title + optional info
tooltip, an optional toolbar (period/metric controls), a fixed-height body that
swaps between a loading placeholder, an empty state, and the chart, plus an
optional legend. Replaces the per-feature \`ChartCard\` / \`ChartCardHeader\`
copies.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ChartCard>;

export const Default: Story = {
  render: () => (
    <ChartCard title="Execution trend">
      <ChartPlaceholder />
    </ChartCard>
  ),
};

export const WithTooltipToolbarAndLegend: Story = {
  render: () => (
    <ChartCard
      title="Usage over time"
      tooltip="Requests and tokens per day for the selected period."
      toolbar={
        <select className="border-border rounded-md border px-2 py-1 text-xs">
          <option>Last 7 days</option>
          <option>Last 30 days</option>
        </select>
      }
      legend={
        <ChartLegend
          items={[
            { label: 'Completed', color: 'var(--color-chart-success)' },
            { label: 'Failed', color: 'var(--color-chart-failure)' },
          ]}
        />
      }
    >
      <ChartPlaceholder />
    </ChartCard>
  ),
};

export const Loading: Story = {
  render: () => (
    <ChartCard title="Execution trend" loading>
      <ChartPlaceholder />
    </ChartCard>
  ),
};

export const Empty: Story = {
  render: () => (
    <ChartCard
      title="Execution trend"
      isEmpty
      emptyIcon={BarChart3}
      emptyTitle="No executions yet"
      emptyDescription="Runs will appear here once your automations start."
    >
      <ChartPlaceholder />
    </ChartCard>
  ),
};
