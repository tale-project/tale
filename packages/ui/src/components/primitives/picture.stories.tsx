import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ResponsiveImage } from '../../images/responsive';
import { Picture } from './picture';

/** One labelled SVG per width, so the story shows which variant the browser picked. */
function variant(width: number, height: number, fill: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><rect width='100%' height='100%' fill='${fill}'/><text x='50%' y='50%' font-size='${width / 12}' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif'>${width}w</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function sample(
  widths: readonly number[],
  ratio: number,
  fill: string,
): ResponsiveImage {
  const variants = Object.fromEntries(
    widths.map((width) => [
      width,
      variant(width, Math.round(width * ratio), fill),
    ]),
  );
  const width = widths.at(-1) ?? 0;
  return {
    width,
    height: Math.round(width * ratio),
    variants: { avif: variants, webp: variants },
  };
}

const DESKTOP = sample([480, 828, 1200, 1600], 0.625, '#7c9cf5');
const PHONE = sample([480, 750], 1.75, '#f5c27c');

const meta: Meta<typeof Picture> = {
  title: 'Primitives/Picture',
  component: Picture,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Picture>;

/** Resize the canvas: the label shows the variant the browser picked for the slot. */
export const Default: Story = {
  render: () => (
    <Picture
      image={DESKTOP}
      sizes="(min-width: 48rem) 48rem, 100vw"
      alt="A responsive sample, labelled with its variant width"
      className="h-auto max-w-full rounded-md"
    />
  ),
};

/** Below 640 px the phone crop replaces the desktop image, with its own size. */
export const ArtDirected: Story = {
  render: () => (
    <Picture
      image={DESKTOP}
      sources={[{ media: '(max-width: 639px)', image: PHONE }]}
      sizes="100vw"
      alt="A desktop sample with a phone crop below 640 px"
      className="h-auto max-w-full rounded-md"
    />
  ),
};
