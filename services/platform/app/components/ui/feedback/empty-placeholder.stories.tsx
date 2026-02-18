import type { Meta, StoryObj } from '@storybook/react';

import { FileText, Inbox, Search, Upload } from 'lucide-react';

import { EmptyPlaceholder } from './empty-placeholder';

const meta: Meta<typeof EmptyPlaceholder> = {
  title: 'Feedback/EmptyPlaceholder',
  component: EmptyPlaceholder,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A dashed-border placeholder for empty states with an optional icon and message.

## Usage
\`\`\`tsx
import { EmptyPlaceholder } from '@/app/components/ui/feedback/empty-placeholder';
import { FileText } from 'lucide-react';

<EmptyPlaceholder icon={FileText}>
  No documents uploaded yet.
</EmptyPlaceholder>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof EmptyPlaceholder>;

export const Default: Story = {
  args: {
    icon: FileText,
    children: 'No documents uploaded yet.',
  },
};

export const WithoutIcon: Story = {
  args: {
    children: 'No items to display.',
  },
};

export const SearchEmpty: Story = {
  args: {
    icon: Search,
    children: 'No results found. Try a different search term.',
  },
};

export const UploadPrompt: Story = {
  args: {
    icon: Upload,
    children: 'Drag and drop files here, or click to upload.',
  },
};

export const InboxEmpty: Story = {
  args: {
    icon: Inbox,
    children: 'Your inbox is empty.',
  },
};

export const CustomClassName: Story = {
  args: {
    icon: FileText,
    children: 'Custom styled placeholder.',
    className: 'bg-muted/30',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Custom className can be applied to adjust background or spacing.',
      },
    },
  },
};
