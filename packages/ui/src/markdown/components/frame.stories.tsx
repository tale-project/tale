import type { Meta, StoryObj } from '@storybook/react';

import { Frame } from './frame';

const meta = {
  title: 'markdown/Frame',
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

export const NoCaption: Story = {
  args: {
    children: (
      <div className="bg-bg-elevated flex h-48 w-full items-center justify-center text-sm">
        no caption — figcaption should not render
      </div>
    ),
  },
};

export const EmptyCaption: Story = {
  args: {
    caption: '   ',
    children: (
      <div className="bg-bg-elevated flex h-48 w-full items-center justify-center text-sm">
        whitespace caption — figcaption should not render
      </div>
    ),
  },
};

export const WithImage: Story = {
  args: {
    caption: 'Native image — lazy-loaded, alt passed through',
    children: (
      <img
        alt="Placeholder landscape"
        loading="lazy"
        src="https://placehold.co/800x300/png"
      />
    ),
  },
};
