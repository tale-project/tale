import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';

import { FilterButton } from './filter-button';
import { FilterSection } from './filter-section';

const meta: Meta = {
  title: 'Forms/Filters',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Filter components for data filtering interfaces.

## Usage
\`\`\`tsx
import { FilterButton, FilterSection } from '@/app/components/ui/filters';

<FilterButton hasActiveFilters={hasFilters} onClick={toggleFilters} />

<FilterSection
  title="Status"
  isExpanded={expanded}
  onToggle={() => setExpanded(!expanded)}
  selectedCount={2}
>
  {/* Filter options */}
</FilterSection>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

export const FilterButtonStates: StoryObj = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <FilterButton hasActiveFilters={false} />
        <p className="text-muted-foreground mt-2 text-xs">Default</p>
      </div>
      <div className="text-center">
        <FilterButton hasActiveFilters={true} />
        <p className="text-muted-foreground mt-2 text-xs">Active</p>
      </div>
      <div className="text-center">
        <FilterButton hasActiveFilters={false} isLoading />
        <p className="text-muted-foreground mt-2 text-xs">Loading</p>
      </div>
    </div>
  ),
};

export const FilterSectionExample: StoryObj = {
  render: function Render() {
    const [expanded, setExpanded] = useState(true);
    return (
      <div className="w-64 rounded-lg border p-1">
        <FilterSection
          title="Status"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        >
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox label="Active" />
          </div>
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox label="Inactive" />
          </div>
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox label="Pending" />
          </div>
        </FilterSection>
      </div>
    );
  },
};

export const FilterSectionWithSelectedCount: StoryObj = {
  render: function Render() {
    const [expanded, setExpanded] = useState(true);
    return (
      <div className="w-64 rounded-lg border p-1">
        <FilterSection
          title="Category"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          selectedCount={2}
        >
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox defaultChecked label="Electronics" />
          </div>
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox defaultChecked label="Clothing" />
          </div>
        </FilterSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Filter section with selected count badge.',
      },
    },
  },
};

export const MultipleFilterSections: StoryObj = {
  render: function Render() {
    const [statusExpanded, setStatusExpanded] = useState(true);
    const [categoryExpanded, setCategoryExpanded] = useState(false);
    const [dateExpanded, setDateExpanded] = useState(false);

    return (
      <div className="w-64 rounded-lg border p-1">
        <FilterSection
          title="Status"
          isExpanded={statusExpanded}
          onToggle={() => setStatusExpanded(!statusExpanded)}
          selectedCount={1}
        >
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox defaultChecked label="Active" />
          </div>
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox label="Inactive" />
          </div>
        </FilterSection>

        <FilterSection
          title="Category"
          isExpanded={categoryExpanded}
          onToggle={() => setCategoryExpanded(!categoryExpanded)}
        >
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox label="Type A" />
          </div>
          <div className="bg-muted rounded-lg px-2 py-3">
            <Checkbox label="Type B" />
          </div>
        </FilterSection>

        <FilterSection
          title="Date Range"
          isExpanded={dateExpanded}
          onToggle={() => setDateExpanded(!dateExpanded)}
        >
          <div className="text-muted-foreground px-2 text-sm">
            Date picker content...
          </div>
        </FilterSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Multiple collapsible filter sections.',
      },
    },
  },
};

export const FilterPanelExample: StoryObj = {
  render: function Render() {
    const [showFilters, setShowFilters] = useState(false);
    const [statusExpanded, setStatusExpanded] = useState(true);
    const hasActiveFilters = true;

    return (
      <div className="flex items-start gap-4">
        <FilterButton
          hasActiveFilters={hasActiveFilters}
          onClick={() => setShowFilters(!showFilters)}
        />

        {showFilters && (
          <div className="w-64 rounded-lg border p-1 shadow-lg">
            <div className="border-border flex items-center justify-between border-b px-2 py-3">
              <span className="text-base font-medium">Filters</span>
              <button
                type="button"
                className="text-primary text-xs font-medium hover:underline"
              >
                Clear all
              </button>
            </div>
            <FilterSection
              title="Status"
              isExpanded={statusExpanded}
              onToggle={() => setStatusExpanded(!statusExpanded)}
              selectedCount={1}
            >
              <div className="bg-muted rounded-lg px-2 py-3">
                <Checkbox defaultChecked label="Published" />
              </div>
              <div className="bg-muted rounded-lg px-2 py-3">
                <Checkbox label="Draft" />
              </div>
            </FilterSection>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Complete filter panel with button toggle.',
      },
    },
  },
};
