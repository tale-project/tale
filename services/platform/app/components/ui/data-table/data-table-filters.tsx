'use client';

import { Button } from '@tale/ui/button';
import { Popover } from '@tale/ui/popover';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Circle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { FilterButton } from '@/app/components/ui/filters/filter-button';
import { FilterSection } from '@/app/components/ui/filters/filter-section';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import type { DatePreset } from '@/app/components/ui/forms/date-range-picker';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

// `flex` on the wrapper: the masked box is `inline-block`, so a block wrapper
// would add baseline whitespace below it (~6px) and the filter bar would
// shrink when the real picker swaps in — a visible bump on first navigation.
const datePickerFallback = (
  <Skeletonize loading className="flex">
    <SkeletonBox>
      <div className="h-9 w-[18rem]" />
    </SkeletonBox>
  </Skeletonize>
);

const DatePickerWithRange = lazyComponent(
  () =>
    import('@/app/components/ui/forms/date-range-picker').then((mod) => ({
      default: mod.DatePickerWithRange,
    })),
  {
    loading: () => datePickerFallback,
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
  /**
   * Number of columns for the options grid.
   * @default 1
   */
  columns?: 1 | 2;
  /** Whether multiple options can be selected (default: false) */
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
    /** Disable the input (e.g. the dataset is empty so there's nothing to search). */
    disabled?: boolean;
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
  /**
   * When `true`, the filter button is rendered disabled and its popover is
   * suppressed — used by `DataTable` when the table has no rows and no
   * active filters, so the affordance can't be opened over an empty set.
   */
  disabled?: boolean;
  /** Callback to clear all filters */
  onClearAll?: () => void;
  /** Additional content to render in the filter bar */
  children?: ReactNode;
  /**
   * Right-aligned toolbar actions (a primary button like "File request").
   * Rendered in the toolbar's right cluster so filters and actions share one
   * baseline instead of every caller re-building the row.
   */
  actions?: ReactNode;
  /** Additional class name */
  className?: string;
}

const EMPTY_FILTERS: FilterConfig[] = [];

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
  filters = EMPTY_FILTERS,
  dateRange,
  isLoading = false,
  disabled = false,
  onClearAll,
  children,
  actions,
  className,
}: DataTableFiltersProps) {
  const { t } = useT('common');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  // `DatePickerWithRange` reads `defaultDate` only via its useState initializer
  // (true `default*` semantics), so calling `dateRange.onChange(undefined)`
  // from `handleClearAll` only updates the parent state — the picker's own
  // local `startDate`/`endDate` survive, and the trigger still shows the old
  // range. Bumping this key forces a remount so the initializer re-reads the
  // now-undefined `defaultDate` and the trigger paints empty again. Cheaper
  // than making the picker fully controlled across every caller.
  const [dateResetKey, setDateResetKey] = useState(0);

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
      // Remount the date picker so its uncontrolled internal state clears.
      // See `dateResetKey`'s declaration for the why.
      setDateResetKey((n) => n + 1);
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
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {search && (
            <SearchInput
              placeholder={search.placeholder ?? t('search.placeholder')}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              disabled={search.disabled}
              className="max-w-none"
              wrapperClassName={cn(
                'flex-1 sm:flex-none',
                search.className ?? 'w-auto sm:w-[18rem]',
              )}
            />
          )}

          {filters.length > 0 && disabled && (
            // Empty table, no active filters — render a plain disabled
            // FilterButton instead of the Popover so the affordance can't be
            // opened over a guaranteed-empty result set. A disabled button on
            // the Popover trigger isn't sufficient: the trigger's wrapper div
            // still toggles the popover.
            <FilterButton
              hasActiveFilters={false}
              isLoading={isLoading}
              disabled
            />
          )}
          {filters.length > 0 && !disabled && (
            <Popover
              open={isFilterOpen}
              onOpenChange={setIsFilterOpen}
              modal={false}
              align="start"
              onOpenAutoFocus={(e) => e.preventDefault()}
              contentClassName="bg-card flex max-h-[min(32rem,calc(100dvh-2rem))] flex-col overflow-hidden p-0"
              trigger={
                <FilterButton
                  hasActiveFilters={totalActiveFilters > 0}
                  isLoading={isLoading}
                />
              }
            >
              <div className="border-border flex shrink-0 items-center justify-between border-b p-3">
                <Text as="span" variant="label" className="text-sm">
                  {t('labels.filters')}
                </Text>
                {totalActiveFilters > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring rounded-md px-2 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
                  >
                    {t('actions.clearAll')}
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                    selectedCount={
                      filter.multiSelect ? filter.selectedValues.length : 0
                    }
                    hasSelection={
                      !filter.multiSelect && filter.selectedValues.length > 0
                    }
                  >
                    {filter.multiSelect ? (
                      <div
                        className={cn(
                          'flex flex-col gap-1',
                          filter.columns === 2 && 'grid grid-cols-2',
                        )}
                      >
                        {filter.options.map((option) => {
                          const checkboxId = `filter-${filter.key}-${option.value}`;
                          const isChecked = filter.selectedValues.includes(
                            option.value,
                          );
                          return (
                            <label
                              key={option.value}
                              htmlFor={checkboxId}
                              className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-lg p-2',
                                isChecked ? 'bg-muted' : 'hover:bg-muted/70',
                              )}
                            >
                              <Checkbox
                                id={checkboxId}
                                checked={isChecked}
                                onCheckedChange={(checked) =>
                                  handleFilterChange(
                                    filter,
                                    option.value,
                                    !!checked,
                                  )
                                }
                              />
                              <Text
                                as="span"
                                variant="muted"
                                className="font-medium"
                              >
                                {option.label}
                              </Text>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        role="radiogroup"
                        aria-label={filter.title}
                        className={cn(
                          'flex flex-col gap-1',
                          filter.columns === 2 && 'grid grid-cols-2',
                        )}
                      >
                        {filter.options.map((option) => {
                          const isSelected =
                            filter.selectedValues[0] === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() =>
                                filter.onChange(
                                  isSelected ? [] : [option.value],
                                )
                              }
                              className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-lg p-2',
                                isSelected ? 'bg-muted' : 'hover:bg-muted/70',
                              )}
                            >
                              <span
                                className={cn(
                                  'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                                  isSelected
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-primary',
                                )}
                                aria-hidden="true"
                              >
                                {isSelected && (
                                  <Circle className="size-2.5 fill-current" />
                                )}
                              </span>
                              <Text
                                as="span"
                                variant="muted"
                                className="font-medium"
                              >
                                {option.label}
                              </Text>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </FilterSection>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {dateRange && (
          <SuspenseBoundary
            fallback={datePickerFallback}
            errorFallback={
              <Text as="span" variant="muted">
                {t('dataTable.dateFilterUnavailable')}
              </Text>
            }
          >
            <DatePickerWithRange
              key={dateResetKey}
              defaultDate={{ from: dateRange.from, to: dateRange.to }}
              onChange={dateRange.onChange}
              presets={dateRange.presets}
              // Mirror the filter button + search: empty table + no active
              // filters => nothing to filter by date against either.
              disabled={disabled}
            />
          </SuspenseBoundary>
        )}

        {children}
      </div>

      {((hasActiveFilters && onClearAll) || actions) && (
        <div className="flex shrink-0 items-center gap-2">
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
          {actions}
        </div>
      )}
    </div>
  );
}
