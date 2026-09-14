import type { Meta, StoryObj } from '@storybook/react';

import { LogoLink } from './logo-link';

const meta: Meta<typeof LogoLink> = {
  title: 'Brand/LogoLink',
  component: LogoLink,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Logo wrapped in a link with hover opacity effect. Used in headers across auth pages, error pages, and status pages.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof LogoLink>;

export const Default: Story = {
  args: {
    href: '/',
  },
};
