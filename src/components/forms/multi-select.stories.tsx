import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { MultiSelect } from './multi-select';

const sampleOptions = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
];

const optionsWithDescriptions = [
  {
    value: 'sales',
    label: 'Sales',
    description: 'Customer-facing revenue team',
  },
  {
    value: 'support',
    label: 'Support',
    description: 'Handles inbound tickets',
  },
  {
    value: 'ops',
    label: 'Operations',
    description: 'Internal logistics and tooling',
  },
];

const manyOptions = Array.from({ length: 1000 }, (_, i) => ({
  value: `member-${i + 1}`,
  label: `Member ${i + 1}`,
}));

const meta: Meta<typeof MultiSelect> = {
  title: 'Forms/MultiSelect',
  component: MultiSelect,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A searchable, scrollable multi-select built on Radix UI Popover. Selected
values render as removable chips in the trigger; the popover lists checkbox
rows that toggle without closing, and large lists (~1000) stay usable via
search + scroll.

## Usage
\`\`\`tsx
import { MultiSelect } from './multi-select';

<MultiSelect
  value={values}
  onValueChange={setValues}
  options={[
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B', description: 'With description' },
  ]}
  placeholder="Select options..."
  searchPlaceholder="Search"
  emptyText="No results found"
/>
\`\`\`

## Keyboard navigation
- **Arrow Down / Up**: Move the highlight
- **Enter**: Toggle the highlighted option (popover stays open)
- **Home / End**: Jump to first / last option
- **Escape**: Close the popover

## Accessibility
- Search input has \`role="combobox"\` with \`aria-activedescendant\`
- Options container has \`role="listbox"\` with \`aria-multiselectable\`
- Each option has \`role="option"\` with \`aria-selected\`
        `,
      },
    },
  },
  argTypes: {
    searchPlaceholder: { control: 'text' },
    emptyText: { control: 'text' },
    searchable: { control: 'boolean' },
    align: {
      control: 'select',
      options: ['start', 'center', 'end'],
    },
  },
  args: {
    onValueChange: fn(),
    searchPlaceholder: 'Search',
    emptyText: 'No results found',
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[30rem] w-[20rem] items-start justify-center pt-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MultiSelect>;

export const Default: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Select fruit...',
  },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>([]);
    return <MultiSelect {...args} value={value} onValueChange={setValue} />;
  },
};

export const WithDescriptions: Story = {
  args: {
    options: optionsWithDescriptions,
    placeholder: 'Select teams...',
    searchPlaceholder: 'Search teams',
    label: 'Teams',
  },
  render: function Render(args) {
    const [value, setValue] = useState(['sales']);
    return <MultiSelect {...args} value={value} onValueChange={setValue} />;
  },
};

export const LargeList: Story = {
  args: {
    options: manyOptions,
    placeholder: 'Add members...',
    searchPlaceholder: 'Search 1000 members',
    label: 'Members',
  },
  render: function Render(args) {
    const [value, setValue] = useState(['member-1', 'member-2', 'member-3']);
    return <MultiSelect {...args} value={value} onValueChange={setValue} />;
  },
};

export const WithoutSearch: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Select fruit...',
    searchable: false,
  },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>([]);
    return <MultiSelect {...args} value={value} onValueChange={setValue} />;
  },
};
