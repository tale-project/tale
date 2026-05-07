import type { Meta, StoryObj } from '@storybook/react';

import { Frame } from './frame';

const meta = {
  title: 'webui/markdown/Frame',
  component: Frame,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Frame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Screenshot: Story = {
  args: {
    caption: 'Tale chat — agent picker',
    children: (
      <div className="bg-bg-elevated flex h-48 w-full items-center justify-center text-sm">
        screenshot placeholder
      </div>
    ),
  },
};
