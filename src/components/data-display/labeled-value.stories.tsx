import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@tale/ui/badge';

import { LabeledValue, LabeledValueGroup } from './labeled-value';

const meta: Meta<typeof LabeledValue> = {
  title: 'Forms/LabeledValue',
  component: LabeledValue,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A labeled value pair component for read-only data display.

## Usage
\`\`\`tsx
import { LabeledValue, LabeledValueGroup } from '@tale/ui/labeled-value';

<LabeledValue label="Email">john@example.com</LabeledValue>

// Group multiple fields
<LabeledValueGroup gap={4}>
  <LabeledValue label="Name">John Doe</LabeledValue>
  <LabeledValue label="Email">john@example.com</LabeledValue>
</LabeledValueGroup>
\`\`\`

## Use Cases
- Detail views and modals
- Information panels
- Settings displays
- Profile pages
        `,
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Label displayed above the value',
    },
  },
};

export default meta;
type Story = StoryObj<typeof LabeledValue>;

export const Default: Story = {
  args: {
    label: 'Email',
    children: 'john@example.com',
  },
};

export const WithBadge: Story = {
  args: {
    label: 'Status',
    children: <Badge variant="green">Active</Badge>,
  },
  parameters: {
    docs: {
      description: {
        story: 'LabeledValue with a badge as the value.',
      },
    },
  },
};

export const LongContent: Story = {
  args: {
    label: 'Description',
    children:
      'This is a longer piece of content that demonstrates how the LabeledValue component handles text that spans multiple lines or contains more detailed information.',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const WithLink: Story = {
  args: {
    label: 'Website',
    children: (
      <a href="https://example.com" className="text-primary hover:underline">
        https://example.com
      </a>
    ),
  },
};

export const GroupedFields: Story = {
  render: () => (
    <LabeledValueGroup gap={4} className="w-80">
      <LabeledValue label="Full name">John Doe</LabeledValue>
      <LabeledValue label="Email">john@example.com</LabeledValue>
      <LabeledValue label="Phone">+1 (555) 123-4567</LabeledValue>
      <LabeledValue label="Location">New York, NY</LabeledValue>
    </LabeledValueGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple fields grouped together with LabeledValueGroup.',
      },
    },
  },
};

export const DifferentGaps: Story = {
  render: () => (
    <div className="flex gap-8">
      <div>
        <p className="text-muted-foreground mb-2 text-xs">gap=2</p>
        <LabeledValueGroup gap={2} className="w-48">
          <LabeledValue label="Name">John</LabeledValue>
          <LabeledValue label="Email">john@email.com</LabeledValue>
        </LabeledValueGroup>
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-xs">gap=4 (default)</p>
        <LabeledValueGroup gap={4} className="w-48">
          <LabeledValue label="Name">John</LabeledValue>
          <LabeledValue label="Email">john@email.com</LabeledValue>
        </LabeledValueGroup>
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-xs">gap=6</p>
        <LabeledValueGroup gap={6} className="w-48">
          <LabeledValue label="Name">John</LabeledValue>
          <LabeledValue label="Email">john@email.com</LabeledValue>
        </LabeledValueGroup>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'LabeledValueGroup with different gap values.',
      },
    },
  },
};

export const ProfileCard: Story = {
  render: () => (
    <div className="w-80 rounded-lg border p-4">
      <h3 className="mb-4 text-lg font-semibold">User profile</h3>
      <LabeledValueGroup gap={4}>
        <LabeledValue label="Name">John Doe</LabeledValue>
        <LabeledValue label="Email">john@example.com</LabeledValue>
        <LabeledValue label="Role">
          <Badge variant="blue">Administrator</Badge>
        </LabeledValue>
        <LabeledValue label="Status">
          <Badge variant="green">Active</Badge>
        </LabeledValue>
        <LabeledValue label="Member since">January 15, 2024</LabeledValue>
      </LabeledValueGroup>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example usage in a profile card.',
      },
    },
  },
};

export const WithCustomValue: Story = {
  render: () => (
    <LabeledValueGroup gap={4} className="w-80">
      <LabeledValue label="Tags">
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">React</Badge>
          <Badge variant="outline">TypeScript</Badge>
          <Badge variant="outline">Node.js</Badge>
        </div>
      </LabeledValue>
      <LabeledValue label="Progress">
        <div className="bg-muted h-2 w-full rounded-full">
          <div
            className="bg-primary h-2 rounded-full"
            style={{ width: '75%' }}
          />
        </div>
      </LabeledValue>
    </LabeledValueGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Custom ReactNode values like tag lists or progress bars.',
      },
    },
  },
};
