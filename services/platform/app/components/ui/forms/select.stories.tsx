import type { Meta, StoryObj } from '@storybook/react';

import { fn } from 'storybook/test';

import { Select } from './select';

const sampleOptions = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
];

const meta: Meta<typeof Select> = {
  title: 'Forms/Select',
  component: Select,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A select dropdown component built on Radix UI Select.

## Usage
\`\`\`tsx
import { Select } from './select';

<Select
  label="Fruit"
  options={[
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
  ]}
  placeholder="Choose a fruit"
/>
\`\`\`

## Accessibility
- Built on Radix UI Select for full ARIA support
- Keyboard navigation with arrow keys
- Type-ahead search support
        `,
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Label displayed above the select',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text when no value selected',
    },
    required: {
      control: 'boolean',
      description: 'Marks the field as required',
    },
    error: {
      control: 'boolean',
      description: 'Shows error state',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the select',
    },
  },
  args: {
    options: sampleOptions,
    onValueChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    placeholder: 'Select a fruit...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Favorite Fruit',
    placeholder: 'Select a fruit...',
  },
};

export const WithDescription: Story = {
  args: {
    label: 'Favorite Fruit',
    description: 'Choose the fruit you enjoy the most.',
    placeholder: 'Select a fruit...',
  },
};

export const Required: Story = {
  args: {
    label: 'Favorite Fruit',
    placeholder: 'Select a fruit...',
    required: true,
  },
};

export const WithError: Story = {
  args: {
    label: 'Favorite Fruit',
    placeholder: 'Select a fruit...',
    error: true,
  },
};

export const WithDisabledOption: Story = {
  args: {
    label: 'Availability',
    placeholder: 'Select...',
    options: [
      { value: 'available', label: 'Available' },
      { value: 'pending', label: 'Pending', disabled: true },
      { value: 'unavailable', label: 'Unavailable' },
    ],
  },
};

export const Disabled: Story = {
  args: {
    label: 'Favorite Fruit',
    placeholder: 'Select a fruit...',
    disabled: true,
  },
};

export const WithDefaultValue: Story = {
  args: {
    label: 'Favorite Fruit',
    defaultValue: 'cherry',
  },
};

export const ManyOptions: Story = {
  args: {
    label: 'Country',
    placeholder: 'Select a country...',
    options: [
      { value: 'us', label: 'United States' },
      { value: 'uk', label: 'United Kingdom' },
      { value: 'ca', label: 'Canada' },
      { value: 'au', label: 'Australia' },
      { value: 'de', label: 'Germany' },
      { value: 'fr', label: 'France' },
      { value: 'jp', label: 'Japan' },
      { value: 'cn', label: 'China' },
      { value: 'in', label: 'India' },
      { value: 'br', label: 'Brazil' },
      { value: 'mx', label: 'Mexico' },
      { value: 'es', label: 'Spain' },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Select with scroll buttons for many options.',
      },
    },
  },
};
