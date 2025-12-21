'use client';

import { useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterButton } from '@/components/filters/filter-button';
import { FilterSection } from '@/components/filters/filter-section';
import { cn } from '@/lib/utils/cn';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  /** Unique key for this filter */
  key: string;
  /** Display title */
  title: string;
  /** Available options */
  options: FilterOption[];
  /** Currently selected values */
  selectedValues: string[];
  /** Callback when selection changes */
  onChange: (values: string[]) => void;
  /** Whether to show options in a grid layout */
  grid?: boolean;
}

export interface DataTableFiltersProps {
  /** Search input configuration */
  search?: {
    /** Current search value */
    value: string;
    /** Callback when search changes */
    onChange: (value: string) => void;
    /** Placeholder text */
    placeholder?: string;
    /** Width class for the search input */
    className?: string;
  };
  /** Filter configurations */
  filters?: FilterConfig[];
  /** Whether filters are loading */
  isLoading?: boolean;
  /** Callback to clear all filters */
  onClearAll?: () => void;
  /** Additional content to render in the filter bar */
  children?: ReactNode;
  /** Additional class name */
  className?: string;
}

/**
 * Composable filter bar for DataTable.
 * 
 * Includes:
 * - Search input with debouncing (handled by parent)
 * - Multi-select filter dropdowns
 * - Clear all button
 */
export function DataTableFilters({
  search,
  filters = [],
  isLoading = false,
  onClearAll,
  children,
  className,
}: DataTableFiltersProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const totalActiveFilters = filters.reduce(
    (acc, filter) => acc + filter.selectedValues.length,
    0,
  );

  const hasActiveFilters = totalActiveFilters > 0 || (search?.value && search.value.length > 0);

  const handleFilterChange = (
    filter: FilterConfig,
    value: string,
    checked: boolean,
  ) => {
    const newValues = checked
      ? [...filter.selectedValues, value]
      : filter.selectedValues.filter((v) => v !== value);
    filter.onChange(newValues);
  };

  const handleClearAll = () => {
    if (search?.onChange) {
      search.onChange('');
    }
    filters.forEach((filter) => filter.onChange([]));
    onClearAll?.();
    setIsFilterOpen(false);
  };

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="flex items-center gap-3">
        {search && (
          <div className={cn('relative', search.className ?? 'w-[18.75rem]')}>
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
            <Input
              placeholder={search.placeholder ?? 'Search...'}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              className="pl-10"
            />
          </div>
        )}

        {filters.length > 0 && (
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen} modal={false}>
            <PopoverTrigger asChild>
              <div>
                <FilterButton hasActiveFilters={totalActiveFilters > 0} isLoading={isLoading} />
              </div>
            </PopoverTrigger>
            <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
              <div className="flex items-center justify-between p-2">
                <h4 className="text-sm font-semibold text-foreground">Filters</h4>
                {totalActiveFilters > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-xs text-primary hover:text-primary/80 font-medium"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {filters.map((filter) => (
                <FilterSection
                  key={filter.key}
                  title={filter.title}
                  isExpanded={expandedSections[filter.key] ?? false}
                  onToggle={() =>
                    setExpandedSections((prev) => ({
                      ...prev,
                      [filter.key]: !prev[filter.key],
                    }))
                  }
                  active={filter.selectedValues.length > 0}
                >
                  <div className={filter.grid ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
                    {filter.options.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Checkbox
                          checked={filter.selectedValues.includes(option.value)}
                          onCheckedChange={(checked) =>
                            handleFilterChange(filter, option.value, !!checked)
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          {option.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </FilterSection>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {children}
      </div>

      {hasActiveFilters && onClearAll && (
        <Button variant="ghost" onClick={handleClearAll} className="gap-2">
          <X className="size-4" />
          Clear all
        </Button>
      )}
    </div>
  );
}

