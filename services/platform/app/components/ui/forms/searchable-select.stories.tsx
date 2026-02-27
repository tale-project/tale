import type { Meta, StoryObj } from "@storybook/react";

import { Plus } from "lucide-react";
import { useState } from "react";
import { fn } from "storybook/test";

import { Button } from "../primitives/button";
import { SearchableSelect } from "./searchable-select";

const sampleOptions = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "date", label: "Date" },
  { value: "elderberry", label: "Elderberry" },
];

const optionsWithDescriptions = [
  {
    value: "chat",
    label: "Chat assistant",
    description: "General-purpose conversational agent",
  },
  {
    value: "writer",
    label: "Content writer",
    description: "Generates blog posts, emails, and copy",
  },
  {
    value: "coder",
    label: "Code assistant",
    description: "Helps with programming tasks",
  },
  {
    value: "analyst",
    label: "Data analyst",
    description: "Analyzes data and creates reports",
  },
];

const manyOptions = Array.from({ length: 20 }, (_, i) => ({
  value: `option-${i + 1}`,
  label: `Option ${i + 1}`,
  description: `Description for option ${i + 1}`,
}));

const meta: Meta<typeof SearchableSelect> = {
  title: "Forms/SearchableSelect",
  component: SearchableSelect,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A searchable dropdown select component built on Radix UI Popover.

## Usage
\`\`\`tsx
import { SearchableSelect } from './searchable-select';

<SearchableSelect
  value={value}
  onValueChange={setValue}
  options={[
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B', description: 'With description' },
  ]}
  trigger={<button>Select...</button>}
  searchPlaceholder="Search..."
  emptyText="No results found"
/>
\`\`\`

## Keyboard navigation
- **Arrow Down / Up**: Navigate options
- **Enter**: Select highlighted option
- **Home / End**: Jump to first / last option
- **Escape**: Close dropdown

## Accessibility
- Search input has \`role="combobox"\` with \`aria-activedescendant\`
- Options container has \`role="listbox"\`
- Each option has \`role="option"\` with \`aria-selected\`
        `,
      },
    },
  },
  argTypes: {
    searchPlaceholder: {
      control: "text",
      description: "Placeholder text for search input",
    },
    emptyText: {
      control: "text",
      description: "Text shown when no options match",
    },
    align: {
      control: "select",
      options: ["start", "center", "end"],
      description: "Popover alignment",
    },
    side: {
      control: "select",
      options: ["top", "right", "bottom", "left"],
      description: "Popover side",
    },
  },
  args: {
    onValueChange: fn(),
    searchPlaceholder: "Search...",
    emptyText: "No results found",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[30rem] items-start justify-center pt-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SearchableSelect>;

export const Default: Story = {
  args: {
    options: sampleOptions,
  },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SearchableSelect
        {...args}
        value={value}
        onValueChange={setValue}
        trigger={
          <Button variant="secondary" size="sm">
            {value
              ? sampleOptions.find((o) => o.value === value)?.label
              : "Select a fruit..."}
          </Button>
        }
      />
    );
  },
};

export const WithDescriptions: Story = {
  args: {
    options: optionsWithDescriptions,
    searchPlaceholder: "Search agents...",
    emptyText: "No agents found",
  },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>("chat");
    return (
      <SearchableSelect
        {...args}
        value={value}
        onValueChange={setValue}
        contentClassName="w-[20rem]"
        trigger={
          <Button variant="secondary" size="sm">
            {optionsWithDescriptions.find((o) => o.value === value)?.label ??
              "Select an agent..."}
          </Button>
        }
      />
    );
  },
};

export const WithSelectedValue: Story = {
  args: {
    options: sampleOptions,
  },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>("cherry");
    return (
      <SearchableSelect
        {...args}
        value={value}
        onValueChange={setValue}
        trigger={
          <Button variant="secondary" size="sm">
            {sampleOptions.find((o) => o.value === value)?.label ??
              "Select a fruit..."}
          </Button>
        }
      />
    );
  },
};

export const WithFooter: Story = {
  args: {
    options: optionsWithDescriptions,
    searchPlaceholder: "Search agents...",
    emptyText: "No agents found",
  },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SearchableSelect
        {...args}
        value={value}
        onValueChange={setValue}
        contentClassName="w-[20rem]"
        footer={
          <Button variant="ghost" size="sm" className="w-full" icon={Plus}>
            Add agent
          </Button>
        }
        trigger={
          <Button variant="secondary" size="sm">
            {optionsWithDescriptions.find((o) => o.value === value)?.label ??
              "Select an agent..."}
          </Button>
        }
      />
    );
  },
};

export const ManyOptions: Story = {
  args: {
    options: manyOptions,
  },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SearchableSelect
        {...args}
        value={value}
        onValueChange={setValue}
        contentClassName="w-[18rem]"
        trigger={
          <Button variant="secondary" size="sm">
            {manyOptions.find((o) => o.value === value)?.label ??
              "Select an option..."}
          </Button>
        }
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "SearchableSelect with many options demonstrating scrolling and keyboard navigation.",
      },
    },
  },
};

export const WithDisabledOptions: Story = {
  args: {
    options: [
      { value: "available", label: "Available" },
      {
        value: "pending",
        label: "Pending",
        description: "Currently unavailable",
        disabled: true,
      },
      { value: "active", label: "Active" },
      {
        value: "archived",
        label: "Archived",
        description: "No longer in use",
        disabled: true,
      },
    ],
  },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SearchableSelect
        {...args}
        value={value}
        onValueChange={setValue}
        trigger={
          <Button variant="secondary" size="sm">
            {args.options.find((o) => o.value === value)?.label ??
              "Select status..."}
          </Button>
        }
      />
    );
  },
};
