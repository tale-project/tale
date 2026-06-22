import type { Meta, StoryObj } from '@storybook/react-vite';

import { Sparkline } from './sparkline';

const sample = [4, 6, 5, 8, 7, 10, 9, 12, 11, 15];

const meta: Meta<typeof Sparkline> = {
  title: 'DataDisplay/Sparkline',
  component: Sparkline,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A tiny inline trend line — pure SVG, no charting dependency. Normalizes its
series to its own min/max. Decorative by default (\`aria-hidden\`); pair it with
a visible value, or pass \`aria-label\` to expose it as an image.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Sparkline>;

export const Default: Story = {
  args: { data: sample },
};

export const Filled: Story = {
  args: { data: sample, filled: true, color: 'var(--color-chart-success)' },
};

export const Downward: Story = {
  args: { data: [...sample].reverse(), color: 'var(--color-chart-failure)' },
};

/** A flat series draws a centered horizontal line rather than dividing by zero. */
export const Flat: Story = {
  args: { data: [5, 5, 5, 5, 5] },
};

export const Larger: Story = {
  args: { data: sample, width: 160, height: 48, filled: true },
};
