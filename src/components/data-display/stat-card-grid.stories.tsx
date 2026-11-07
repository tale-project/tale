import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info } from 'lucide-react';

import { Skeletonize } from '../feedback/skeleton-context';
import { StatCard, StatCardGrid } from './stat-card-grid';

const meta: Meta<typeof StatCardGrid> = {
  title: 'DataDisplay/StatCardGrid',
  component: StatCardGrid,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A bordered, divided strip of headline metrics. Pass already formatted/translated
strings; each \`StatCard\` masks its value while a surrounding \`<Skeletonize loading>\`
is active so the strip height never shifts. Dividers come from a 1px grid gap over
a border-colored background, so wrapped rows keep full-length rules — pick a
\`cols\` value that fills every row.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatCardGrid>;

/** The default 4-column summary strip. */
export const FourColumn: Story = {
  render: () => (
    <StatCardGrid>
      <StatCard label="Total requests" value="12,480" />
      <StatCard label="Total tokens" value="3.2M" />
      <StatCard label="Total cost" value="$184.20" />
      <StatCard
        label="Active users"
        value="312"
        tooltip={
          <Info className="ml-1 inline-block size-3 align-text-bottom" />
        }
      />
    </StatCardGrid>
  ),
};

/** Two metrics. */
export const TwoColumn: Story = {
  render: () => (
    <StatCardGrid cols={2}>
      <StatCard label="Success rate" value="98.6%" />
      <StatCard label="Avg duration" value="1.4s" />
    </StatCardGrid>
  ),
};

/** Six metrics in a filled 3×2 strip (avoids a short last row). */
export const ThreeColumnWrapped: Story = {
  render: () => (
    <StatCardGrid cols={3}>
      <StatCard label="Total turns" value="1,240" />
      <StatCard label="Success rate" value="94%" />
      <StatCard label="Timeout rate" value="2%" />
      <StatCard label="p95 duration" value="12.0s" />
      <StatCard label="Stopped by user" value="18" />
      <StatCard label="Recovered" value="7" />
    </StatCardGrid>
  ),
};

/** A wide `colSpan={2}` cell with extra content under the value (e.g. a bar). */
export const WithColSpan: Story = {
  render: () => (
    <StatCardGrid>
      <StatCard label="Sentiment" value="Positive" colSpan={2}>
        <div className="bg-bg-muted mt-2 h-2 w-full overflow-hidden rounded-full">
          <div className="bg-success h-full w-3/4" />
        </div>
      </StatCard>
      <StatCard label="Helpful" value="248" />
      <StatCard label="Not helpful" value="36" />
    </StatCardGrid>
  ),
};

/** While loading, every value masks to its line box — no layout shift. */
export const Loading: Story = {
  render: () => (
    <Skeletonize loading>
      <StatCardGrid>
        <StatCard label="Total requests" value="12,480" />
        <StatCard label="Total tokens" value="3.2M" loadingWidth="w-20" />
        <StatCard label="Total cost" value="$184.20" />
        <StatCard label="Active users" value="312" />
      </StatCardGrid>
    </Skeletonize>
  ),
};
