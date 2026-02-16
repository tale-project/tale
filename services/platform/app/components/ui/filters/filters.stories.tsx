import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';

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
      <div className="w-64 rounded-lg border p-2">
        <FilterSection
          title="Status"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          active={false}
        >
          <div className="space-y-2">
            <Checkbox label="Active" />
            <Checkbox label="Inactive" />
            <Checkbox label="Pending" />
          </div>
        </FilterSection>
      </div>
    );
  },
};

export const FilterSectionActive: StoryObj = {
  render: function Render() {
    const [expanded, setExpanded] = useState(true);
    return (
      <div className="w-64 rounded-lg border p-2">
        <FilterSection
          title="Category"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          active={true}
        >
          <div className="space-y-2">
            <Checkbox defaultChecked label="Electronics" />
            <Checkbox label="Clothing" />
          </div>
        </FilterSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Filter section with active indicator dot.',
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
      <div className="w-64 space-y-1 rounded-lg border p-2">
        <FilterSection
          title="Status"
          isExpanded={statusExpanded}
          onToggle={() => setStatusExpanded(!statusExpanded)}
          active={true}
        >
          <div className="space-y-2">
            <Checkbox defaultChecked label="Active" />
            <Checkbox label="Inactive" />
          </div>
        </FilterSection>

        <FilterSection
          title="Category"
          isExpanded={categoryExpanded}
          onToggle={() => setCategoryExpanded(!categoryExpanded)}
        >
          <div className="space-y-2">
            <Checkbox label="Type A" />
            <Checkbox label="Type B" />
          </div>
        </FilterSection>

        <FilterSection
          title="Date Range"
          isExpanded={dateExpanded}
          onToggle={() => setDateExpanded(!dateExpanded)}
        >
          <div className="text-muted-foreground text-sm">
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

export const FilterSectionWithRadioGroup: StoryObj = {
  render: function Render() {
    const [expanded, setExpanded] = useState(true);
    const [value, setValue] = useState('newest');

    return (
      <div className="w-64 rounded-lg border p-2">
        <FilterSection
          title="Sort by"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          active={value !== 'newest'}
        >
          <RadioGroup
            value={value}
            onValueChange={setValue}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'name-asc', label: 'Name A–Z' },
              { value: 'name-desc', label: 'Name Z–A' },
            ]}
          />
        </FilterSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Filter section with a radio group for single-select options.',
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
          <div className="w-64 rounded-lg border p-2 shadow-lg">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-sm font-medium">Filters</span>
              <button className="text-primary text-xs hover:underline">
                Clear all
              </button>
            </div>
            <FilterSection
              title="Status"
              isExpanded={statusExpanded}
              onToggle={() => setStatusExpanded(!statusExpanded)}
              active={true}
            >
              <div className="space-y-2">
                <Checkbox defaultChecked label="Published" />
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
