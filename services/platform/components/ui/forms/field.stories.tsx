import type { Meta, StoryObj } from '@storybook/react';
import { Field, FieldGroup } from './field';
import { Badge } from '../feedback/badge';

const meta: Meta<typeof Field> = {
  title: 'Forms/Field',
  component: Field,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A labeled value pair component for read-only data display.

## Usage
\`\`\`tsx
import { Field, FieldGroup } from '@/components/ui/forms/field';

<Field label="Email">john@example.com</Field>

// Group multiple fields
<FieldGroup gap={4}>
  <Field label="Name">John Doe</Field>
  <Field label="Email">john@example.com</Field>
</FieldGroup>
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
type Story = StoryObj<typeof Field>;

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
        story: 'Field with a badge as the value.',
      },
    },
  },
};

export const LongContent: Story = {
  args: {
    label: 'Description',
    children:
      'This is a longer piece of content that demonstrates how the Field component handles text that spans multiple lines or contains more detailed information.',
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
    <FieldGroup gap={4} className="w-80">
      <Field label="Full Name">John Doe</Field>
      <Field label="Email">john@example.com</Field>
      <Field label="Phone">+1 (555) 123-4567</Field>
      <Field label="Location">New York, NY</Field>
    </FieldGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple fields grouped together with FieldGroup.',
      },
    },
  },
};

export const DifferentGaps: Story = {
  render: () => (
    <div className="flex gap-8">
      <div>
        <p className="text-xs text-muted-foreground mb-2">gap=2</p>
        <FieldGroup gap={2} className="w-48">
          <Field label="Name">John</Field>
          <Field label="Email">john@email.com</Field>
        </FieldGroup>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">gap=4 (default)</p>
        <FieldGroup gap={4} className="w-48">
          <Field label="Name">John</Field>
          <Field label="Email">john@email.com</Field>
        </FieldGroup>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">gap=6</p>
        <FieldGroup gap={6} className="w-48">
          <Field label="Name">John</Field>
          <Field label="Email">john@email.com</Field>
        </FieldGroup>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'FieldGroup with different gap values.',
      },
    },
  },
};

export const ProfileCard: Story = {
  render: () => (
    <div className="w-80 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">User Profile</h3>
      <FieldGroup gap={4}>
        <Field label="Name">John Doe</Field>
        <Field label="Email">john@example.com</Field>
        <Field label="Role">
          <Badge variant="blue">Administrator</Badge>
        </Field>
        <Field label="Status">
          <Badge variant="green">Active</Badge>
        </Field>
        <Field label="Member Since">January 15, 2024</Field>
      </FieldGroup>
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
    <FieldGroup gap={4} className="w-80">
      <Field label="Tags">
        <div className="flex gap-1 flex-wrap">
          <Badge variant="outline">React</Badge>
          <Badge variant="outline">TypeScript</Badge>
          <Badge variant="outline">Node.js</Badge>
        </div>
      </Field>
      <Field label="Progress">
        <div className="w-full bg-muted rounded-full h-2">
          <div className="bg-primary h-2 rounded-full" style={{ width: '75%' }} />
        </div>
      </Field>
    </FieldGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Custom ReactNode values like tag lists or progress bars.',
      },
    },
  },
};
