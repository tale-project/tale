import type { Meta, StoryObj } from '@storybook/react';

import { ImageZoom } from './image-zoom';

const RESPONSIVE_WIDTHS = [480, 828, 1200, 1600];
const placeholder = (width: number, format: string) =>
  `https://placehold.co/${width}x${(width * 5) / 8}/${format}?text=${width}w+${format}`;

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

// With `image` the trigger serves the variant its slot needs (the label names
// it); the lightbox still opens the full-size file.
export const Responsive: Story = {
  args: {
    src: placeholder(2880, 'webp'),
    alt: 'Responsive screenshot — resize the canvas to switch variants',
    sizes: '(min-width: 48rem) 48rem, 100vw',
    image: {
      width: 2880,
      height: 1800,
      variants: {
        avif: Object.fromEntries(
          RESPONSIVE_WIDTHS.map((width) => [width, placeholder(width, 'avif')]),
        ),
        webp: Object.fromEntries(
          RESPONSIVE_WIDTHS.map((width) => [width, placeholder(width, 'webp')]),
        ),
      },
    },
  },
};
