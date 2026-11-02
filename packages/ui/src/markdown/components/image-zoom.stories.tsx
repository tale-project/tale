import type { Meta, StoryObj } from '@storybook/react';

import { MOBILE_QUERY } from '../../hooks/use-is-mobile';
import type { ResponsiveImage } from '../../images/responsive';
import { ImageZoom } from './image-zoom';

const RESPONSIVE_WIDTHS = [480, 828, 1200, 1600];
const placeholder = (width: number, format: string) =>
  `https://placehold.co/${width}x${(width * 5) / 8}/${format}?text=${width}w+${format}`;
// A phone capture: 390×844 CSS px at DPR 2.
const PHONE_WIDTHS = [480, 780];
const phonePlaceholder = (width: number, format: string) =>
  `https://placehold.co/${width}x${Math.round((width * 844) / 390)}/${format}?text=phone+${width}w+${format}`;
const responsiveImage = (
  width: number,
  height: number,
  widths: number[],
  url: (width: number, format: string) => string,
): ResponsiveImage => ({
  width,
  height,
  variants: {
    avif: Object.fromEntries(widths.map((size) => [size, url(size, 'avif')])),
    webp: Object.fromEntries(widths.map((size) => [size, url(size, 'webp')])),
  },
});

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
    image: responsiveImage(2880, 1800, RESPONSIVE_WIDTHS, placeholder),
  },
};

// With `sources` the capture of Tale's phone layout replaces `image` below
// the `md` breakpoint, in the trigger and in the lightbox alike.
export const PhoneCapture: Story = {
  args: {
    src: placeholder(2880, 'webp'),
    alt: 'Screenshot with a phone capture — narrow the canvas below 768 px',
    sizes: '(min-width: 48rem) 48rem, 100vw',
    image: responsiveImage(2880, 1800, RESPONSIVE_WIDTHS, placeholder),
    sources: [
      {
        media: MOBILE_QUERY,
        image: responsiveImage(780, 1688, PHONE_WIDTHS, phonePlaceholder),
        src: phonePlaceholder(780, 'webp'),
      },
    ],
  },
};
