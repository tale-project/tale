import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';
import { fn } from 'storybook/test';

import { SearchInput } from './search-input';

const meta: Meta<typeof SearchInput> = {
  title: 'Forms/SearchInput',
  component: SearchInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A specialized search input component with a built-in search icon.

## Usage
\`\`\`tsx
import { SearchInput } from './search-input';

<SearchInput
  value={searchValue}
  onChange={(e) => setSearchValue(e.target.value)}
  placeholder="Search..."
/>
\`\`\`

## Features
- Consistent size (sm / h-8) for compact design
- Search icon positioned at left with proper spacing
- Supports label, description, and errorMessage props
- Accepts all standard input props
- Accessible with proper ARIA attributes

## Accessibility
- Search icon has \`aria-hidden="true"\` to avoid screen reader duplication
- Label, description, and error message follow the same pattern as Input/Textarea/Select
- Keyboard accessible with proper focus states
        `,
      },
    },
  },
  argTypes: {
    value: {
      control: 'text',
      description: 'Current search value',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the input',
    },
    className: {
      control: 'text',
      description: 'Additional classes for the input element',
    },
    wrapperClassName: {
      control: 'text',
      description: 'Additional classes for the wrapper div',
    },
    label: {
      control: 'text',
      description: 'Label text displayed above the input',
    },
    description: {
      control: 'text',
      description: 'Description text displayed below the input',
    },
    errorMessage: {
      control: 'text',
      description: 'Error message displayed below the input',
    },
    required: {
      control: 'boolean',
      description: 'Shows required indicator on label',
    },
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
type Story = StoryObj<typeof SearchInput>;

export const Default: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search..."
      />
    );
  },
};

export const WithValue: Story = {
  render: function Render() {
    const [value, setValue] = useState('Example search query');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search..."
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Search input with a populated value.',
      },
    },
  },
};

export const CustomPlaceholder: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products..."
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Search input with custom placeholder text.',
      },
    },
  },
};

export const Disabled: Story = {
  render: () => (
    <SearchInput
      value="Cannot edit"
      onChange={fn()}
      placeholder="Search..."
      disabled
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Disabled search input.',
      },
    },
  },
};

export const InFilterBar: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <div className="flex items-center gap-3">
        <SearchInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search customers..."
        />
        <button
          type="button"
          className="border-border hover:bg-accent rounded-lg border px-3 py-2 text-sm"
        >
          Filters
        </button>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Example of SearchInput in a filter bar context.',
      },
    },
  },
};

export const Multiple: Story = {
  render: function Render() {
    const [v1, setV1] = useState('');
    const [v2, setV2] = useState('');
    const [v3, setV3] = useState('');
    return (
      <div className="flex flex-col gap-4">
        <SearchInput
          value={v1}
          onChange={(e) => setV1(e.target.value)}
          placeholder="Search customers..."
        />
        <SearchInput
          value={v2}
          onChange={(e) => setV2(e.target.value)}
          placeholder="Search products..."
        />
        <SearchInput
          value={v3}
          onChange={(e) => setV3(e.target.value)}
          placeholder="Search orders..."
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Multiple search inputs showing visual consistency.',
      },
    },
  },
};

export const WithLabel: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search..."
        label="Search"
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Search input with a label.',
      },
    },
  },
};

export const WithDescription: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search..."
        label="Search"
        description="Search by name, email, or ID"
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Search input with label and description.',
      },
    },
  },
};

export const WithError: Story = {
  render: () => (
    <SearchInput
      value=""
      onChange={fn()}
      placeholder="Search..."
      label="Search"
      errorMessage="Please enter a search term"
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Search input displaying an error message.',
      },
    },
  },
};

export const Required: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search..."
        label="Search"
        required
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Search input with required indicator.',
      },
    },
  },
};

export const CustomStyling: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search conversations..."
        className="bg-transparent shadow-none"
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Search input with custom styling via className prop for special contexts.',
      },
    },
  },
};
