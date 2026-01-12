import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { FilterButton } from './filter-button';
import { FilterSection } from './filter-section';
import { Checkbox } from '@/components/ui/forms/checkbox';
import { Label } from '@/components/ui/forms/label';

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
import { FilterButton, FilterSection } from '@/components/ui/filters';

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
    <div className="flex gap-4 items-center">
      <div className="text-center">
        <FilterButton hasActiveFilters={false} />
        <p className="text-xs text-muted-foreground mt-2">Default</p>
      </div>
      <div className="text-center">
        <FilterButton hasActiveFilters={true} />
        <p className="text-xs text-muted-foreground mt-2">Active</p>
      </div>
      <div className="text-center">
        <FilterButton hasActiveFilters={false} isLoading />
        <p className="text-xs text-muted-foreground mt-2">Loading</p>
      </div>
    </div>
  ),
};

export const FilterSectionExample: StoryObj = {
  render: function Render() {
    const [expanded, setExpanded] = useState(true);
    return (
      <div className="w-64 border rounded-lg p-2">
        <FilterSection
          title="Status"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          active={false}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="active" />
              <Label htmlFor="active" className="text-sm">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="inactive" />
              <Label htmlFor="inactive" className="text-sm">
                Inactive
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pending" />
              <Label htmlFor="pending" className="text-sm">
                Pending
              </Label>
            </div>
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
      <div className="w-64 border rounded-lg p-2">
        <FilterSection
          title="Category"
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          active={true}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="cat1" defaultChecked />
              <Label htmlFor="cat1" className="text-sm">
                Electronics
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="cat2" />
              <Label htmlFor="cat2" className="text-sm">
                Clothing
              </Label>
            </div>
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
      <div className="w-64 border rounded-lg p-2 space-y-1">
        <FilterSection
          title="Status"
          isExpanded={statusExpanded}
          onToggle={() => setStatusExpanded(!statusExpanded)}
          active={true}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="s1" defaultChecked />
              <Label htmlFor="s1" className="text-sm">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="s2" />
              <Label htmlFor="s2" className="text-sm">
                Inactive
              </Label>
            </div>
          </div>
        </FilterSection>

        <FilterSection
          title="Category"
          isExpanded={categoryExpanded}
          onToggle={() => setCategoryExpanded(!categoryExpanded)}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="c1" />
              <Label htmlFor="c1" className="text-sm">
                Type A
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="c2" />
              <Label htmlFor="c2" className="text-sm">
                Type B
              </Label>
            </div>
          </div>
        </FilterSection>

        <FilterSection
          title="Date Range"
          isExpanded={dateExpanded}
          onToggle={() => setDateExpanded(!dateExpanded)}
        >
          <div className="text-sm text-muted-foreground">
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
      <div className="flex gap-4">
        <FilterButton
          hasActiveFilters={hasActiveFilters}
          onClick={() => setShowFilters(!showFilters)}
        />

        {showFilters && (
          <div className="w-64 border rounded-lg p-2 shadow-lg">
            <div className="flex items-center justify-between mb-2 px-2">
              <span className="text-sm font-medium">Filters</span>
              <button className="text-xs text-primary hover:underline">
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
                <div className="flex items-center gap-2">
                  <Checkbox id="p1" defaultChecked />
                  <Label htmlFor="p1" className="text-sm">
                    Published
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="p2" />
                  <Label htmlFor="p2" className="text-sm">
                    Draft
                  </Label>
                </div>
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
