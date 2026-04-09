import type { Meta, StoryObj } from '@storybook/react';

import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Text } from '@/app/components/ui/typography/text';

import { FullPageCenter } from './full-page-center';

const meta: Meta<typeof FullPageCenter> = {
  title: 'Layout/FullPageCenter',
  component: FullPageCenter,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Centers content both vertically and horizontally in a full-height viewport. Used for loading screens, error pages, and empty states.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof FullPageCenter>;

export const Default: Story = {
  render: () => (
    <FullPageCenter>
      <Text>Centered content</Text>
    </FullPageCenter>
  ),
};

export const WithSpinner: Story = {
  render: () => (
    <FullPageCenter>
      <Spinner label="Loading..." />
    </FullPageCenter>
  ),
};
