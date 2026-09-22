import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatCard, StatCardGrid } from './stat-card-grid';
import { TrendIndicator } from './trend-indicator';

const meta: Meta<typeof TrendIndicator> = {
  title: 'DataDisplay/TrendIndicator',
  component: TrendIndicator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A compact period-over-period delta: a direction arrow + signed percentage,
sentiment-colored (green = good, red = bad). Pass the current \`value\` and the
\`previous\` value — the percentage and the "no prior data → neutral" rule are
computed inside (see \`computeTrend\`). Use \`inverted\` for metrics where a
decrease is good (cost, failures, latency).
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TrendIndicator>;

/** An increase on a normal metric reads as positive (green up). */
export const Up: Story = {
  args: { value: 1284, previous: 1100, comparisonLabel: 'vs last period' },
};

/** A decrease on a normal metric reads as negative (red down). */
export const Down: Story = {
  args: { value: 920, previous: 1100, comparisonLabel: 'vs last period' },
};

/** With `inverted`, a decrease is good — e.g. cost or failures going down. */
export const InvertedGood: Story = {
  args: {
    value: 42,
    previous: 60,
    inverted: true,
    comparisonLabel: 'vs last period',
  },
};

/** No prior period (new org / first window) renders a neutral dash, never ±100%. */
export const NoPriorData: Story = {
  args: { value: 12, previous: 0, comparisonLabel: 'vs last period' },
};

/** In context: deltas sit under the value inside a `StatCard`. */
export const InStatCard: Story = {
  render: () => (
    <div className="w-[40rem]">
      <StatCardGrid cols={2}>
        <StatCard label="Total runs" value="1,284">
          <TrendIndicator
            value={1284}
            previous={1100}
            comparisonLabel="vs last period"
          />
        </StatCard>
        <StatCard label="Failed runs" value="36">
          <TrendIndicator
            value={36}
            previous={58}
            inverted
            comparisonLabel="vs last period"
          />
        </StatCard>
      </StatCardGrid>
    </div>
  ),
};
