import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Checkbox } from './checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Forms/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A checkbox component built on Radix UI Checkbox.

## Usage
\`\`\`tsx
import { Checkbox } from './checkbox';

<Checkbox label="Accept terms" />
<Checkbox checked="indeterminate" label="Select all" />
\`\`\`

## Accessibility
- Built on Radix UI Checkbox for full ARIA support
- Supports checked, unchecked, and indeterminate states
- Label is clickable and properly associated
        `,
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Label displayed next to the checkbox',
    },
    checked: {
      control: 'select',
      options: [true, false, 'indeterminate'],
      description: 'Checked state',
    },
    required: {
      control: 'boolean',
      description: 'Marks the field as required',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the checkbox',
    },
  },
  args: {
    onCheckedChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: {},
};

export const WithLabel: Story = {
  args: {
    label: 'Accept terms and conditions',
  },
};

export const Checked: Story = {
  args: {
    label: 'Email notifications',
    checked: true,
  },
};

export const Indeterminate: Story = {
  args: {
    label: 'Select all items',
    checked: 'indeterminate',
  },
  parameters: {
    docs: {
      description: {
        story: 'Indeterminate state for partial selection.',
      },
    },
  },
};

export const Required: Story = {
  args: {
    label: 'I agree to the terms',
    required: true,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Disabled checkbox',
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  args: {
    label: 'Disabled checked',
    checked: true,
    disabled: true,
  },
};

export const CheckboxGroup: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Checkbox label="Option 1" />
      <Checkbox label="Option 2" />
      <Checkbox label="Option 3" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple checkboxes in a group.',
      },
    },
  },
};
