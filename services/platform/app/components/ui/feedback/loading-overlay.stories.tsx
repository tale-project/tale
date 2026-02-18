import type { Meta, StoryObj } from '@storybook/react';

import { LoadingOverlay } from './loading-overlay';

const meta: Meta<typeof LoadingOverlay> = {
  title: 'Feedback/LoadingOverlay',
  component: LoadingOverlay,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A translucent overlay with a spinner and message, used to indicate a blocking operation on a region of the UI.

## Usage
\`\`\`tsx
import { LoadingOverlay } from '@/app/components/ui/feedback/loading-overlay';

<div className="relative">
  <LoadingOverlay message="Saving changes..." />
  {/* content underneath */}
</div>
\`\`\`

## Accessibility
- Uses \`role="status"\` and \`aria-live="polite"\` for screen reader announcements
- The parent container must have \`position: relative\` for correct positioning
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="relative h-64 w-full rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">Content underneath</p>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof LoadingOverlay>;

export const Default: Story = {
  args: {
    message: 'Updating...',
  },
};

export const SavingChanges: Story = {
  args: {
    message: 'Saving changes...',
  },
};

export const Processing: Story = {
  args: {
    message: 'Processing items...',
  },
};
