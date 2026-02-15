import type { Meta, StoryObj } from '@storybook/react';

import { fn } from '@storybook/test';

import { Textarea } from './textarea';

const meta: Meta<typeof Textarea> = {
  title: 'Forms/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A textarea component with label and error handling.

## Usage
\`\`\`tsx
import { Textarea } from './textarea';

<Textarea label="Description" placeholder="Enter description..." />
<Textarea errorMessage="This field is required" />
\`\`\`

## Accessibility
- Labels are properly associated via \`htmlFor\`
- Error messages use \`aria-describedby\` and \`role="alert"\`
- Shake animation on error provides visual feedback
        `,
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Label displayed above the textarea',
    },
    errorMessage: {
      control: 'text',
      description: 'Error message displayed below',
    },
    required: {
      control: 'boolean',
      description: 'Marks the field as required',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the textarea',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
  },
  args: {
    onChange: fn(),
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
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    placeholder: 'Enter your message...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
  },
};

export const WithDescription: Story = {
  args: {
    label: 'Bio',
    description: 'Write a short description about yourself.',
    placeholder: 'Tell us about yourself...',
  },
};

export const Required: Story = {
  args: {
    label: 'Bio',
    required: true,
    placeholder: 'Tell us about yourself...',
  },
};

export const WithError: Story = {
  args: {
    label: 'Message',
    defaultValue: 'Hi',
    errorMessage: 'Message must be at least 10 characters',
  },
  parameters: {
    docs: {
      description: {
        story: 'Error state with shake animation and accessible error message.',
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    label: 'Notes',
    disabled: true,
    defaultValue: 'This content cannot be edited.',
  },
};

export const WithDefaultValue: Story = {
  args: {
    label: 'Feedback',
    defaultValue:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  },
};

export const CustomRows: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Textarea label="Small (3 rows)" rows={3} placeholder="Small textarea" />
      <Textarea label="Large (8 rows)" rows={8} placeholder="Large textarea" />
    </div>
  ),
};
