import type { Meta, StoryObj } from '@storybook/react';

import { Inbox, Search, Users } from 'lucide-react';

import { Button } from '../primitives/button';
import { EmptyState } from './empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A full-area empty state component with an optional icon, title, description, and action.

## Usage
\`\`\`tsx
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Inbox } from 'lucide-react';

<EmptyState
  icon={Inbox}
  title="No messages"
  description="When you receive messages, they will appear here."
  action={<Button>Compose message</Button>}
/>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    icon: Inbox,
    title: 'No messages',
    description: 'When you receive messages, they will appear here.',
  },
};

export const WithAction: Story = {
  args: {
    icon: Users,
    title: 'No team members',
    description: 'Invite people to your team to collaborate on projects.',
    action: <Button>Invite member</Button>,
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state with a call-to-action button.',
      },
    },
  },
};

export const TitleOnly: Story = {
  args: {
    icon: Search,
    title: 'No results found',
  },
  parameters: {
    docs: {
      description: {
        story: 'Minimal empty state with only an icon and title.',
      },
    },
  },
};

export const WithoutIcon: Story = {
  args: {
    title: 'Nothing here yet',
    description: 'Items will appear once they have been added.',
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state without an icon, relying on text alone.',
      },
    },
  },
};
