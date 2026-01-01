'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import type {
  TypeFilter,
  PriorityFilter,
  FilterState,
} from '@/hooks/use-conversation-filters';
import { FilterSection } from '@/components/filters/filter-section';
import { FilterButton } from '@/components/filters/filter-button';
import { useT } from '@/lib/i18n';

// Export these for reuse in other components
export type { TypeFilter, PriorityFilter, FilterState };

interface FilterDropdownProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  isLoading?: boolean;
}

type TypeOptionKey = 'productRecommendation' | 'serviceRequest' | 'churnSurvey' | 'general' | 'spam';
type PriorityOptionKey = 'low' | 'medium' | 'high';

const typeOptions: { id: TypeFilter; labelKey: TypeOptionKey }[] = [
  { id: 'product_recommendation' as TypeFilter, labelKey: 'productRecommendation' },
  { id: 'service_request' as TypeFilter, labelKey: 'serviceRequest' },
  { id: 'churn_survey' as TypeFilter, labelKey: 'churnSurvey' },
  { id: 'general' as TypeFilter, labelKey: 'general' },
  { id: 'spam' as TypeFilter, labelKey: 'spam' },
];

const priorityOptions: { id: PriorityFilter; labelKey: PriorityOptionKey }[] = [
  { id: 'low' as PriorityFilter, labelKey: 'low' },
  { id: 'medium' as PriorityFilter, labelKey: 'medium' },
  { id: 'high' as PriorityFilter, labelKey: 'high' },
];

interface FilterOptionProps {
  id: string;
  label: string;
  isSelected: boolean;
  onToggle: () => void;
}

function FilterOption({ label, isSelected, onToggle }: FilterOptionProps) {
  return (
    <label className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted cursor-pointer">
      <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      <span className="text-sm text-foreground flex-1">{label}</span>
    </label>
  );
}

export function FilterDropdown({
  filters,
  onFiltersChange,
  isLoading = false,
}: FilterDropdownProps) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    type: false,
    priority: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleTypeToggle = (typeId: TypeFilter) => {
    // Handle multi-selection - toggle the item in the array
    const newTypes = filters.types.includes(typeId)
      ? filters.types.filter((id) => id !== typeId)
      : [...filters.types, typeId];
    onFiltersChange({ ...filters, types: newTypes });
  };

  const handlePriorityToggle = (priorityId: PriorityFilter) => {
    // Handle multi-selection - toggle the item in the array
    const newPriorities = filters.priorities.includes(priorityId)
      ? filters.priorities.filter((id) => id !== priorityId)
      : [...filters.priorities, priorityId];
    onFiltersChange({ ...filters, priorities: newPriorities });
  };

  const handleClearAll = () => {
    onFiltersChange({
      types: [],
      priorities: [],
    });
    setIsOpen(false);
  };

  const hasActiveFilters =
    filters.types.length > 0 || filters.priorities.length > 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <PopoverTrigger asChild>
        <div>
          <FilterButton
            className="p-2"
            hasActiveFilters={hasActiveFilters}
            isLoading={isLoading}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Header */}
        <div className="flex items-center justify-between p-2">
          <h4 className="text-sm font-semibold text-foreground">{t('filters.title')}</h4>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              {tCommon('actions.clearAll')}
            </button>
          )}
        </div>

        {/* Type Section */}
        <FilterSection
          title={t('filters.type')}
          isExpanded={expandedSections.type}
          onToggle={() => toggleSection('type')}
          active={filters.types.length > 0}
        >
          {typeOptions.map((option) => (
            <FilterOption
              key={option.id}
              id={option.id}
              label={t(`filters.typeOptions.${option.labelKey}`)}
              isSelected={filters.types.includes(option.id)}
              onToggle={() => handleTypeToggle(option.id)}
            />
          ))}
        </FilterSection>

        {/* Priority Section */}
        <FilterSection
          title={t('filters.priority')}
          isExpanded={expandedSections.priority}
          onToggle={() => toggleSection('priority')}
          active={filters.priorities.length > 0}
        >
          {priorityOptions.map((option) => (
            <FilterOption
              key={option.id}
              id={option.id}
              label={t(`filters.priorityOptions.${option.labelKey}`)}
              isSelected={filters.priorities.includes(option.id)}
              onToggle={() => handlePriorityToggle(option.id)}
            />
          ))}
        </FilterSection>
      </PopoverContent>
    </Popover>
  );
}
