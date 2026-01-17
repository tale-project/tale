import type { Meta, StoryObj } from '@storybook/react';
import { RadioGroup, RadioGroupItem } from './radio-group';

const meta: Meta<typeof RadioGroup> = {
  title: 'Forms/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A radio group component for selecting one option from a set.

## Usage
\`\`\`tsx
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/forms/radio-group';

<RadioGroup defaultValue="option1">
  <RadioGroupItem value="option1" label="Option 1" />
  <RadioGroupItem value="option2" label="Option 2" />
</RadioGroup>
\`\`\`

## Accessibility
- Full keyboard navigation with arrow keys
- ARIA radio group roles and states
- Labels associated with inputs
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="comfortable">
      <RadioGroupItem value="default" label="Default" />
      <RadioGroupItem value="comfortable" label="Comfortable" />
      <RadioGroupItem value="compact" label="Compact" />
    </RadioGroup>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <RadioGroup defaultValue="email" label="Notification preferences" required>
      <RadioGroupItem value="email" label="Email notifications" />
      <RadioGroupItem value="sms" label="SMS notifications" />
      <RadioGroupItem value="push" label="Push notifications" />
      <RadioGroupItem value="none" label="No notifications" />
    </RadioGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'RadioGroup can have a label that describes the entire group.',
      },
    },
  },
};

export const Horizontal: Story = {
  render: () => (
    <RadioGroup defaultValue="medium" className="flex gap-4">
      <RadioGroupItem value="small" label="Small" />
      <RadioGroupItem value="medium" label="Medium" />
      <RadioGroupItem value="large" label="Large" />
    </RadioGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Radio items can be arranged horizontally with flex.',
      },
    },
  },
};

export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup defaultValue="free" label="Select a plan">
      <RadioGroupItem value="free" label="Free" />
      <RadioGroupItem value="pro" label="Pro" />
      <RadioGroupItem value="enterprise" label="Enterprise" disabled />
    </RadioGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Individual radio items can be disabled.',
      },
    },
  },
};

export const WithoutLabels: Story = {
  render: () => (
    <RadioGroup defaultValue="red" className="flex gap-2">
      <RadioGroupItem
        value="red"
        className="data-[state=checked]:border-red-500 data-[state=checked]:text-red-500"
        aria-label="Red"
      />
      <RadioGroupItem
        value="green"
        className="data-[state=checked]:border-green-500 data-[state=checked]:text-green-500"
        aria-label="Green"
      />
      <RadioGroupItem
        value="blue"
        className="data-[state=checked]:border-blue-500 data-[state=checked]:text-blue-500"
        aria-label="Blue"
      />
    </RadioGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Radio items without visible labels should have aria-label for accessibility.',
      },
    },
  },
};

export const FormExample: Story = {
  render: () => (
    <form className="space-y-6 w-80">
      <RadioGroup defaultValue="standard" label="Shipping method" required>
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <RadioGroupItem value="standard" label="Standard (5-7 days)" />
          <span className="text-sm font-medium">Free</span>
        </div>
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <RadioGroupItem value="express" label="Express (2-3 days)" />
          <span className="text-sm font-medium">$9.99</span>
        </div>
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <RadioGroupItem value="overnight" label="Overnight" />
          <span className="text-sm font-medium">$19.99</span>
        </div>
      </RadioGroup>
    </form>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Radio groups styled as selection cards for forms.',
      },
    },
  },
};
