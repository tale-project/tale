import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartLegend } from './chart-legend';

const meta: Meta<typeof ChartLegend> = {
  title: 'DataDisplay/ChartLegend',
  component: ChartLegend,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
The shared chart legend row — a swatch + label (+ optional value) per series.
Colors should come from chart-theme tokens (\`var(--color-chart-*)\`) so the
legend matches the chart in both themes.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ChartLegend>;

export const Default: Story = {
  args: {
    items: [
      { label: 'Completed', color: 'var(--color-chart-success)' },
      { label: 'Failed', color: 'var(--color-chart-failure)' },
    ],
  },
};

export const WithValues: Story = {
  args: {
    items: [
      {
        label: 'Completed',
        color: 'var(--color-chart-success)',
        value: '1,284',
      },
      { label: 'Failed', color: 'var(--color-chart-failure)', value: '36' },
      { label: 'Running', color: 'var(--color-chart-neutral)', value: '12' },
    ],
  },
};

export const StartAligned: Story = {
  args: {
    align: 'start',
    items: [
      { label: 'Requests', color: 'var(--color-chart-1)' },
      { label: 'Input tokens', color: 'var(--color-chart-2)' },
      { label: 'Output tokens', color: 'var(--color-chart-3)' },
    ],
  },
};
