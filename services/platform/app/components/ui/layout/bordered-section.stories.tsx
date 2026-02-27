import type { Meta, StoryObj } from '@storybook/react';

import { Input } from '../forms/input';
import { Switch } from '../forms/switch';
import { BorderedSection } from './bordered-section';

const meta: Meta<typeof BorderedSection> = {
  title: 'Layout/BorderedSection',
  component: BorderedSection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A bordered container for grouping related content.

## Usage
\`\`\`tsx
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';

<BorderedSection>
  <p>Content goes here.</p>
</BorderedSection>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof BorderedSection>;

export const Default: Story = {
  args: {
    children: (
      <>
        <p className="text-sm">Default bordered section.</p>
        <p className="text-muted-foreground text-sm">
          A second line of content.
        </p>
      </>
    ),
  },
};

export const WithForm: Story = {
  args: {
    children: (
      <>
        <Input label="Name" placeholder="Enter name" />
        <Input label="Email" type="email" placeholder="name@example.com" />
        <Switch label="Enable notifications" />
      </>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Bordered section wrapping form fields for visual grouping.',
      },
    },
  },
};
