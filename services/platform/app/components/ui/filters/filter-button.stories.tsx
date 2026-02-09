import type { Meta, StoryObj } from '@storybook/react';

import { FilterButton } from './filter-button';

const meta: Meta<typeof FilterButton> = {
  title: 'Forms/FilterButton',
  component: FilterButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An icon button that indicates filter state. Shows a filter icon by default, a spinner when loading, and an indicator dot when filters are active.

## Usage
\`\`\`tsx
import { FilterButton } from '@/app/components/ui/filters/filter-button';

<FilterButton hasActiveFilters={hasFilters} isLoading={isLoading} onClick={toggle} />
\`\`\`

## Accessibility
- Renders as a button element via the Button primitive
- Icon-only button should be used with an accessible label via the parent context
        `,
      },
    },
  },
  argTypes: {
    hasActiveFilters: {
      control: 'boolean',
    },
    isLoading: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof FilterButton>;

export const Default: Story = {
  args: {
    hasActiveFilters: false,
  },
};

export const ActiveFilters: Story = {
  args: {
    hasActiveFilters: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'When filters are active, a blue indicator dot appears and the border becomes primary-colored.',
      },
    },
  },
};

export const Loading: Story = {
  args: {
    hasActiveFilters: false,
    isLoading: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state shows a spinning icon and reduces opacity.',
      },
    },
  },
};

export const LoadingWithActiveFilters: Story = {
  args: {
    hasActiveFilters: true,
    isLoading: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'When loading with active filters, the spinner is shown but the indicator dot is hidden.',
      },
    },
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <FilterButton hasActiveFilters={false} />
        <span className="text-muted-foreground text-xs">Default</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <FilterButton hasActiveFilters={true} />
        <span className="text-muted-foreground text-xs">Active</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <FilterButton hasActiveFilters={false} isLoading />
        <span className="text-muted-foreground text-xs">Loading</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <FilterButton hasActiveFilters={true} isLoading />
        <span className="text-muted-foreground text-xs">Loading + active</span>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All four visual states side by side.',
      },
    },
  },
};
