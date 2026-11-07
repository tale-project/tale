import type { Meta, StoryObj } from '@storybook/react';

import { TierCard } from './tier-card';

const meta = {
  title: 'Blocks/TierCard',
  component: TierCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TierCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Free: Story = {
  args: {
    name: 'Free',
    price: 'Free',
    priceSuffix: ' ',
    tagline: 'For tinkerers — run Tale locally with full features.',
    children: (
      <ul className="flex flex-col gap-2 text-sm">
        <li>Self-host on your own infrastructure</li>
        <li>Unlimited workspaces</li>
        <li>Support from the community forum</li>
      </ul>
    ),
  },
};

export const Pro: Story = {
  args: {
    name: 'Pro',
    popular: true,
    popularLabel: 'Popular',
    price: 'CHF 299',
    priceSuffix: '/mo + VAT',
    priceFootnote: 'Billed yearly · 2 months free',
    tagline: 'For teams — managed cloud + dedicated support.',
    children: (
      <ul className="flex flex-col gap-2 text-sm">
        <li>Everything in Free</li>
        <li>Managed hosting</li>
        <li>Email + Slack support</li>
        <li>99.9% uptime SLA</li>
      </ul>
    ),
  },
};

export const Disabled: Story = {
  args: {
    name: 'Free',
    price: 'Free',
    priceSuffix: ' ',
    tagline: 'Not included in this view.',
    disabled: true,
  },
};
