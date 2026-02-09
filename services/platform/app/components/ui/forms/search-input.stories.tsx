import type { Meta, StoryObj } from '@storybook/react';

import { fn } from '@storybook/test';

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
- Accepts all standard input props
- Accessible with proper ARIA attributes

## Accessibility
- Search icon has \`aria-hidden="true"\` to avoid screen reader duplication
- Standard input accessibility features inherited from Input component
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
  },
  args: {
    onChange: fn(),
    value: '',
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
  args: {
    placeholder: 'Search...',
  },
};

export const WithValue: Story = {
  args: {
    placeholder: 'Search...',
    value: 'Example search query',
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
  args: {
    placeholder: 'Search products...',
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
  args: {
    placeholder: 'Search...',
    value: 'Cannot edit',
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Disabled search input.',
      },
    },
  },
};

export const InFilterBar: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <SearchInput value="" onChange={fn()} placeholder="Search customers..." />
      <button
        type="button"
        className="border-border hover:bg-accent rounded-lg border px-3 py-2 text-sm"
      >
        Filters
      </button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example of SearchInput in a filter bar context.',
      },
    },
  },
};

export const Multiple: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <SearchInput value="" onChange={fn()} placeholder="Search customers..." />
      <SearchInput value="" onChange={fn()} placeholder="Search products..." />
      <SearchInput value="" onChange={fn()} placeholder="Search orders..." />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple search inputs showing visual consistency.',
      },
    },
  },
};

export const CustomStyling: Story = {
  args: {
    placeholder: 'Search conversations...',
    className: 'bg-transparent shadow-none',
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
