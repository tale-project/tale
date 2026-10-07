import type { Meta, StoryObj } from '@storybook/react';

import { Markdown } from '../markdown';
import { Frame } from './frame';
import { ImageZoom } from './image-zoom';
import { markdownComponents } from './registry';

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

// The base markdown img renderer wraps images in a zoom-trigger <button> and
// adds its own border + margin; inside a Frame those must be neutralized so
// only the Frame border shows (no double chrome).
export const WithZoomableImage: Story = {
  args: {
    caption: 'Zoomable image — single Frame border, no inner border or margin',
    children: (
      <ImageZoom
        alt="Placeholder landscape"
        src="https://placehold.co/800x300/png"
      />
    ),
  },
};

// Full markdown pipeline: `![alt](src)` inside <Frame> arrives as
// <p><button><img/></button></p>; wrapper margins and the inner border must
// collapse away.
export const MarkdownAuthored: Story = {
  render: () => (
    <Markdown components={markdownComponents}>
      {
        '<Frame caption="Authored in markdown">\n\n![Placeholder landscape](https://placehold.co/800x300/png)\n\n</Frame>'
      }
    </Markdown>
  ),
};
