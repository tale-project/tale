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

export const Community: Story = {
  args: {
    name: 'Community',
    price: 'Free',
    priceSuffix: ' ',
    tagline: 'For tinkerers — run Tale locally with full features.',
    children: (
      <ul className="flex flex-col gap-2 text-sm">
        <li>Self-host on your own hardware</li>
        <li>Unlimited workspaces</li>
        <li>Community support</li>
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
        <li>Everything in Community</li>
        <li>Managed hosting</li>
        <li>Email + Slack support</li>
        <li>99.9% uptime SLA</li>
      </ul>
    ),
  },
};

export const Disabled: Story = {
  args: {
    name: 'Community',
    price: 'Free',
    priceSuffix: ' ',
    tagline: 'Not available on Cloud — switch to Self-hosted to start free.',
    disabled: true,
  },
};
