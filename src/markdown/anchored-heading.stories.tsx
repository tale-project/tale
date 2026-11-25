import type { Meta, StoryObj } from '@storybook/react';

import { AnchoredHeading } from './anchored-heading';

const meta = {
  title: 'markdown/AnchoredHeading',
  component: AnchoredHeading,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AnchoredHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const H1: Story = {
  args: {
    level: 'h1',
    className: 'text-fg-base text-3xl font-semibold',
    children: 'Heading 1 — anchor on hover',
  },
};

export const H2: Story = {
  args: {
    level: 'h2',
    className: 'text-fg-base text-2xl font-semibold',
    children: 'Heading 2 — anchor on hover',
  },
};

export const H3: Story = {
  args: {
    level: 'h3',
    className: 'text-fg-base text-lg font-semibold',
    children: 'Heading 3 — anchor on hover',
  },
};

export const H4: Story = {
  args: {
    level: 'h4',
    className: 'text-fg-base text-base font-semibold',
    children: 'Heading 4 — anchor on hover',
  },
};

export const LongTitle: Story = {
  args: {
    level: 'h2',
    className: 'text-fg-base max-w-prose text-2xl font-semibold',
    children:
      'A wrapped, multi-line heading that still slugifies the full text correctly',
  },
};
