import type { Meta, StoryObj } from '@storybook/react';

import { ImageZoom } from './image-zoom';

const meta = {
  title: 'markdown/ImageZoom',
  component: ImageZoom,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ImageZoom>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    src: 'https://placehold.co/800x300/png',
    alt: 'Placeholder landscape',
  },
};

// Without alt text the trigger and dialog title fall back to the generic
// translated zoom label instead of an empty accessible name.
export const NoAlt: Story = {
  args: {
    src: 'https://placehold.co/800x300/png',
  },
};

export const Portrait: Story = {
  args: {
    src: 'https://placehold.co/400x900/png',
    alt: 'Tall portrait screenshot — the lightbox caps at ~90vh',
  },
};
