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

### Simple (options prop)
\`\`\`tsx
import { RadioGroup } from '@/app/components/ui/forms/radio-group';

<RadioGroup
  defaultValue="comfortable"
  options={[
    { value: 'default', label: 'Default' },
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
  ]}
/>
\`\`\`

### Custom layout (children)
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
    <RadioGroup
      defaultValue="comfortable"
      options={[
        { value: 'default', label: 'Default' },
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact' },
      ]}
    />
  ),
};

export const WithLabel: Story = {
  render: () => (
    <RadioGroup
      defaultValue="email"
      label="Notification preferences"
      required
      options={[
        { value: 'email', label: 'Email notifications' },
        { value: 'sms', label: 'SMS notifications' },
        { value: 'push', label: 'Push notifications' },
        { value: 'none', label: 'No notifications' },
      ]}
    />
  ),
};

export const WithDescription: Story = {
  render: () => (
    <RadioGroup
      defaultValue="email"
      label="Notification preferences"
      description="Choose how you want to receive notifications."
      options={[
        { value: 'email', label: 'Email notifications' },
        { value: 'sms', label: 'SMS notifications' },
        { value: 'push', label: 'Push notifications' },
      ]}
    />
  ),
};

export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup
      defaultValue="free"
      label="Select a plan"
      options={[
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
        { value: 'enterprise', label: 'Enterprise', disabled: true },
      ]}
    />
  ),
};

export const Horizontal: Story = {
  render: () => (
    <RadioGroup
      defaultValue="medium"
      className="flex gap-4"
      options={[
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Radio items can be arranged horizontally with flex.',
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
        story:
          'Radio items without visible labels should have aria-label for accessibility. Use children with RadioGroupItem for custom styling.',
      },
    },
  },
};

export const FormExample: Story = {
  render: () => (
    <form className="w-80 space-y-6">
      <RadioGroup defaultValue="standard" label="Shipping method" required>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <RadioGroupItem value="standard" label="Standard (5-7 days)" />
          <span className="text-sm font-medium">Free</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <RadioGroupItem value="express" label="Express (2-3 days)" />
          <span className="text-sm font-medium">$9.99</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <RadioGroupItem value="overnight" label="Overnight" />
          <span className="text-sm font-medium">$19.99</span>
        </div>
      </RadioGroup>
    </form>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use children with RadioGroupItem for custom layouts like selection cards.',
      },
    },
  },
};
