import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../primitives/button';
import { SectionHeader } from './section-header';

const meta: Meta<typeof SectionHeader> = {
  title: 'Layout/SectionHeader',
  component: SectionHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Section header for page sections with a title, optional description, and optional trailing action.

## Usage
\`\`\`tsx
import { SectionHeader } from '@/app/components/ui/layout/section-header';

<SectionHeader title="Members" description="Manage team members and permissions." />

<SectionHeader
  title="Example Messages"
  description="Add example messages to train the AI."
  action={<Button>Add Example</Button>}
/>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof SectionHeader>;

export const Default: Story = {
  args: {
    title: 'Members',
    description: 'Manage team members and their access permissions.',
  },
};

export const TitleOnly: Story = {
  args: {
    title: 'Change Password',
  },
};

export const WithAction: Story = {
  args: {
    title: 'Example Messages',
    description: 'Add example messages to help define your tone of voice.',
    action: <Button size="sm">Add Example</Button>,
  },
};

export const SizeSm: Story = {
  args: {
    title: 'Team Documents',
    size: 'sm',
    as: 'h3',
    weight: 'medium',
  },
  parameters: {
    docs: {
      description: {
        story: 'Small size with medium weight, used for sub-section headers.',
      },
    },
  },
};

export const SizeLg: Story = {
  args: {
    title: 'Tone of Voice',
    description: 'Configure how the AI communicates with your customers.',
    size: 'lg',
  },
};

export const AsH3: Story = {
  args: {
    title: 'Recommended Products',
    as: 'h3',
    size: 'lg',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Heading rendered as h3 for use inside dialogs or nested sections.',
      },
    },
  },
};

export const WithReactNodeTitle: Story = {
  args: {
    title: (
      <>
        Generated Tone{' '}
        <span className="text-muted-foreground ml-2 text-xs">Optional</span>
      </>
    ),
    description:
      'The AI-generated tone of voice based on your example messages.',
    as: 'h3',
    size: 'lg',
  },
  parameters: {
    docs: {
      description: {
        story: 'Title can be a ReactNode to include badges or annotations.',
      },
    },
  },
};

export const WithStatusIndicator: Story = {
  args: {
    title: 'General',
    description: 'Configure the basic settings for this agent.',
    action: <span className="text-muted-foreground text-xs">Saved</span>,
  },
  parameters: {
    docs: {
      description: {
        story: 'Action slot used for a save status indicator.',
      },
    },
  },
};
