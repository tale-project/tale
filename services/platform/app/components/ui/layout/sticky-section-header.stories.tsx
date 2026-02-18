import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../primitives/button';
import { StickySectionHeader } from './sticky-section-header';

const meta: Meta<typeof StickySectionHeader> = {
  title: 'Layout/StickySectionHeader',
  component: StickySectionHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A sticky section header that pins to the top of its scroll container.
Wraps SectionHeader inside a sticky container with background and z-index.

## Usage
\`\`\`tsx
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';

<StickySectionHeader
  title="Instructions"
  description="Define the system prompt."
  action={<Button size="sm">Save</Button>}
/>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof StickySectionHeader>;

export const Default: Story = {
  args: {
    title: 'Instructions',
    description: 'Define the system instructions for this agent.',
  },
};

export const TitleOnly: Story = {
  args: {
    title: 'Tools',
  },
};

export const WithAction: Story = {
  args: {
    title: 'Instructions',
    description: 'Define the system instructions for this agent.',
    action: <Button size="sm">Save</Button>,
  },
};

export const SmallSize: Story = {
  args: {
    title: 'Sub-section',
    size: 'sm',
    as: 'h3',
    weight: 'medium',
  },
  parameters: {
    docs: {
      description: {
        story: 'Small size with medium weight for sub-section headers.',
      },
    },
  },
};

export const LargeSize: Story = {
  args: {
    title: 'Agent Configuration',
    description: 'Manage agent settings and behavior.',
    size: 'lg',
  },
};

export const Scrollable: Story = {
  args: {
    title: 'Instructions',
    description: 'Scroll down to see the sticky behavior.',
    action: <Button size="sm">Save</Button>,
  },
  decorators: [
    (Story) => (
      <div className="h-[300px] overflow-y-auto rounded-lg border">
        <div className="h-[800px] p-4">
          <Story />
          <p className="text-muted-foreground mt-4 text-sm">
            Scroll to see the header stick to the top.
          </p>
        </div>
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Demonstrates sticky behavior inside a scrollable container.',
      },
    },
  },
};
