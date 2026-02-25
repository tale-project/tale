import type { Meta, StoryObj } from '@storybook/react';

import { fn } from 'storybook/test';

import { FilePreviewCard } from './file-preview-card';

const meta: Meta<typeof FilePreviewCard> = {
  title: 'DataDisplay/FilePreviewCard',
  component: FilePreviewCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A card that displays a file name with its icon, optional file size, and an optional remove button.

## Usage
\`\`\`tsx
import { FilePreviewCard } from '@/app/components/ui/data-display/file-preview-card';

<FilePreviewCard
  fileName="report.pdf"
  fileSize={204800}
  onRemove={() => handleRemove()}
/>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof FilePreviewCard>;

export const Default: Story = {
  args: {
    fileName: 'document.pdf',
  },
};

export const WithFileSize: Story = {
  args: {
    fileName: 'report.pdf',
    fileSize: 204800,
  },
  parameters: {
    docs: {
      description: {
        story: 'Displays a human-readable file size below the file name.',
      },
    },
  },
};

export const WithRemove: Story = {
  args: {
    fileName: 'attachment.png',
    fileSize: 512000,
    onRemove: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a remove button when the onRemove callback is provided.',
      },
    },
  },
};

export const LongFileName: Story = {
  args: {
    fileName: 'very-long-file-name-that-should-be-truncated-with-ellipsis.docx',
    fileSize: 1048576,
    onRemove: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Long file names are truncated with an ellipsis to preserve layout.',
      },
    },
  },
};
