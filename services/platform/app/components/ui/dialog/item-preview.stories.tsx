import type { Meta, StoryObj } from '@storybook/react';
import { ItemPreview } from './item-preview';

const meta: Meta<typeof ItemPreview> = {
  title: 'Dialog/ItemPreview',
  component: ItemPreview,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A preview component for showing item details in confirmation dialogs.

## Usage
\`\`\`tsx
import { ItemPreview } from '@/app/components/ui/dialog/item-preview';

<ItemPreview
  primary="Acme Corporation"
  secondary="contact@acme.com"
/>
\`\`\`

## Use Cases
- Delete confirmation dialogs
- Archive confirmation dialogs
- Any action that affects a specific item
        `,
      },
    },
  },
  argTypes: {
    primary: {
      control: 'text',
      description: 'Primary text (e.g., item name)',
    },
    secondary: {
      control: 'text',
      description: 'Secondary text (e.g., description, email)',
    },
  },
};

export default meta;
type Story = StoryObj<typeof ItemPreview>;

export const Default: Story = {
  args: {
    primary: 'Acme Corporation',
    secondary: 'contact@acme.com',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const PrimaryOnly: Story = {
  args: {
    primary: 'Project Alpha',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Preview with only primary text.',
      },
    },
  },
};

export const LongText: Story = {
  args: {
    primary: 'This is a very long item name that might wrap to multiple lines',
    secondary: 'This is additional descriptive text that provides more context about the item being displayed',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Handling long text content.',
      },
    },
  },
};

export const UserPreview: Story = {
  args: {
    primary: 'John Doe',
    secondary: 'john.doe@company.com',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const DocumentPreview: Story = {
  args: {
    primary: 'quarterly-report-2024.pdf',
    secondary: '2.4 MB • Modified Jan 15, 2024',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const Multiple: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <ItemPreview
        primary="Customer A"
        secondary="customer-a@example.com"
      />
      <ItemPreview
        primary="Customer B"
        secondary="customer-b@example.com"
      />
      <ItemPreview
        primary="Customer C"
        secondary="customer-c@example.com"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple previews stacked (e.g., for bulk delete).',
      },
    },
  },
};
