import type { Meta, StoryObj } from '@storybook/react';

import { Text } from '../typography/text';
import { ZoomPanViewer } from './zoom-pan-viewer';

const SAMPLE_IMAGE =
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop';

const meta: Meta<typeof ZoomPanViewer> = {
  title: 'Data Display/ZoomPanViewer',
  component: ZoomPanViewer,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An interactive image viewer with zoom, pan, and scroll-wheel support.

## Usage
\`\`\`tsx
import { ZoomPanViewer } from '@/app/components/ui/data-display/zoom-pan-viewer';

<ZoomPanViewer
  src="/image.jpg"
  alt="Description"
  toolbarPosition="inline"
/>
\`\`\`

## Features
- Zoom in/out with buttons or scroll wheel (0.5x–3x)
- Pan by dragging when zoomed in
- Reset zoom button
- Overlay or inline toolbar positioning
- Optional header content alongside toolbar
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 600, height: 400 }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    toolbarPosition: {
      control: 'radio',
      options: ['overlay', 'bottom', 'inline'],
    },
  },
};

// Storybook requires default export for meta
// oxlint-disable-next-line no-default-export -- Storybook convention
export default meta;
type Story = StoryObj<typeof ZoomPanViewer>;

export const Default: Story = {
  args: {
    src: SAMPLE_IMAGE,
    alt: 'Mountain landscape',
    toolbarPosition: 'overlay',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Default overlay toolbar positioned at the top-right. Ideal for dialog/modal use cases.',
      },
    },
  },
};

export const InlineToolbar: Story = {
  args: {
    src: SAMPLE_IMAGE,
    alt: 'Mountain landscape',
    toolbarPosition: 'inline',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Inline toolbar rendered above the image in normal document flow. Ideal for embedded previews.',
      },
    },
  },
};

export const WithHeaderContent: Story = {
  args: {
    src: SAMPLE_IMAGE,
    alt: 'Mountain landscape',
    toolbarPosition: 'overlay',
    headerContent: (
      <Text as="span" truncate className="text-foreground/80 max-w-[60%]">
        landscape-photo.jpg
      </Text>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Overlay toolbar with header content (e.g. filename) rendered to the left of controls.',
      },
    },
  },
};

export const BottomToolbar: Story = {
  args: {
    src: SAMPLE_IMAGE,
    alt: 'Mountain landscape',
    toolbarPosition: 'bottom',
    imageClassName: 'rounded-xl border',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Floating pill toolbar at the bottom center, matching the PDF preview toolbar design.',
      },
    },
  },
};

export const WithImageStyling: Story = {
  args: {
    src: SAMPLE_IMAGE,
    alt: 'Styled image',
    toolbarPosition: 'inline',
    imageClassName: 'rounded-xl border',
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom image styling with rounded corners and border.',
      },
    },
  },
};
