'use client';

import type { DateRange } from 'react-day-picker';

import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { DatePreset } from '@/app/components/ui/forms/date-range-picker';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FilterButton } from '@/app/components/ui/filters/filter-button';
import { FilterSection } from '@/app/components/ui/filters/filter-section';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/overlays/popover';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

const DatePickerWithRange = lazyComponent(
  () =>
    import('@/app/components/ui/forms/date-range-picker').then((mod) => ({
      default: mod.DatePickerWithRange,
    })),
  {
    loading: () => <Skeleton className="h-9 w-[24rem]" />,
  },
);

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
  /** Whether multiple options can be selected (default: true) */
  multiSelect?: boolean;
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
  /** Date range filter configuration */
  dateRange?: {
    /** Start date */
    from?: Date;
    /** End date */
    to?: Date;
    /** Callback when date range changes */
    onChange: (range: DateRange | undefined) => void;
    /** Which presets to show in the dropdown */
    presets?: DatePreset[];
  };
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
  dateRange,
  isLoading = false,
  onClearAll,
  children,
  className,
}: DataTableFiltersProps) {
  const { t } = useT('common');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

  const totalActiveFilters = filters.reduce(
    (acc, filter) => acc + filter.selectedValues.length,
    0,
  );

  const hasDateRange = dateRange?.from || dateRange?.to;
  const hasActiveFilters =
    totalActiveFilters > 0 ||
    (search?.value && search.value.length > 0) ||
    hasDateRange;

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
    if (dateRange?.onChange) {
      dateRange.onChange(undefined);
    }
    onClearAll?.();
    setIsFilterOpen(false);
  };

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4',
        className,
      )}
    >
      <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex w-full items-center gap-3 sm:w-auto">
          {search && (
            <SearchInput
              placeholder={search.placeholder ?? t('search.placeholder')}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              wrapperClassName={cn(
                'flex-1 sm:flex-none',
                search.className ?? 'w-full sm:w-[18.75rem]',
              )}
            />
          )}

          {filters.length > 0 && (
            <Popover
              open={isFilterOpen}
              onOpenChange={setIsFilterOpen}
              modal={false}
            >
              <PopoverTrigger asChild>
                <div>
                  <FilterButton
                    hasActiveFilters={totalActiveFilters > 0}
                    isLoading={isLoading}
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent
                className="space-y-0"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between p-2">
                  <h4 className="text-foreground text-sm font-semibold">
                    {t('labels.filters')}
                  </h4>
                  {totalActiveFilters > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-primary hover:text-primary/80 text-xs font-medium"
                    >
                      {t('actions.clearAll')}
                    </button>
                  )}
                </div>

                {filters.map((filter) => {
                  const isMultiSelect = filter.multiSelect !== false;
                  return (
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
                      {isMultiSelect ? (
                        <div
                          className={
                            filter.grid ? 'grid grid-cols-2 gap-2' : 'space-y-2'
                          }
                        >
                          {filter.options.map((option) => {
                            const checkboxId = `filter-${filter.key}-${option.value}`;
                            return (
                              <label
                                key={option.value}
                                htmlFor={checkboxId}
                                className="flex cursor-pointer items-center gap-2"
                              >
                                <Checkbox
                                  id={checkboxId}
                                  checked={filter.selectedValues.includes(
                                    option.value,
                                  )}
                                  onCheckedChange={(checked) =>
                                    handleFilterChange(
                                      filter,
                                      option.value,
                                      !!checked,
                                    )
                                  }
                                />
                                <span className="text-muted-foreground text-sm">
                                  {option.label}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <RadioGroup
                          value={filter.selectedValues[0] ?? ''}
                          onValueChange={(value) =>
                            filter.onChange(value ? [value] : [])
                          }
                          className="space-y-2"
                        >
                          {filter.options.map((option) => (
                            <RadioGroupItem
                              key={option.value}
                              value={option.value}
                              label={option.label}
                            />
                          ))}
                        </RadioGroup>
                      )}
                    </FilterSection>
                  );
                })}
              </PopoverContent>
            </Popover>
          )}
        </div>

        {dateRange && (
          <SuspenseBoundary
            fallback={<Skeleton className="h-9 w-[24rem]" />}
            errorFallback={
              <span className="text-muted-foreground text-sm">
                Date filter unavailable
              </span>
            }
          >
            <DatePickerWithRange
              defaultDate={{ from: dateRange.from, to: dateRange.to }}
              onChange={dateRange.onChange}
              presets={dateRange.presets}
            />
          </SuspenseBoundary>
        )}

        {children}
      </div>

      {hasActiveFilters && onClearAll && (
        <Button
          variant="ghost"
          onClick={handleClearAll}
          className="hidden gap-2 sm:flex"
        >
          <X className="size-4" />
          {t('actions.clearAll')}
        </Button>
      )}
    </div>
  );
}
