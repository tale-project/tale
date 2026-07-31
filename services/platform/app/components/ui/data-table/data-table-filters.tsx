'use client';

import { Button } from '@tale/ui/button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import {
  FilterPanel,
  isFilterActive,
  type FilterConfig,
} from '@/app/components/ui/filters/filter-panel';
import type { DatePreset } from '@/app/components/ui/forms/date-range-picker';
import {
  SearchInput,
  TOOLBAR_SEARCH_WRAPPER,
} from '@/app/components/ui/forms/search-input';
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

// The facet model and its predicates live with the panel that renders them
// (`filters/filter-panel`), so the card catalogs can use them without importing
// out of `data-table`. Re-exported here for the table callers that already
// import them from this module.
export {
  isFilterActive,
  isFilterAffordanceDisabled,
} from '@/app/components/ui/filters/filter-panel';
export type {
  FilterConfig,
  FilterOption,
} from '@/app/components/ui/filters/filter-panel';

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
  /**
   * Which edge of the filter button the panel pins to. Keep the default
   * `'start'` for left-anchored toolbars; pass `'end'` when the button sits
   * at the right edge of the page (the metrics headers), so the panel hangs
   * from the button's bottom-right corner instead of running off-viewport.
   */
  align?: 'start' | 'end';
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
  align = 'start',
  className,
}: DataTableFiltersProps) {
  const { t } = useT('common');
  // `DatePickerWithRange` reads `defaultDate` only via its useState initializer
  // (true `default*` semantics), so calling `dateRange.onChange(undefined)`
  // from `handleClearAll` only updates the parent state — the picker's own
  // local `startDate`/`endDate` survive, and the trigger still shows the old
  // range. Bumping this key forces a remount so the initializer re-reads the
  // now-undefined `defaultDate` and the trigger paints empty again. Cheaper
  // than making the picker fully controlled across every caller.
  const [dateResetKey, setDateResetKey] = useState(0);

  const activeFilterCount = filters.filter(isFilterActive).length;

  const hasDateRange = dateRange?.from || dateRange?.to;
  const hasActiveFilters =
    activeFilterCount > 0 ||
    (search?.value && search.value.length > 0) ||
    hasDateRange;

  const handleClearAll = () => {
    if (search?.onChange) {
      search.onChange('');
    }
    filters.forEach((filter) => filter.onChange(filter.defaultValues ?? []));
    if (dateRange?.onChange) {
      dateRange.onChange(undefined);
      // Remount the date picker so its uncontrolled internal state clears.
      // See `dateResetKey`'s declaration for the why.
      setDateResetKey((n) => n + 1);
    }
    onClearAll?.();
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
              // A caller-supplied width wins over the shared default (they're
              // merged, so `search.className` only has to name the widths it
              // changes).
              wrapperClassName={cn(TOOLBAR_SEARCH_WRAPPER, search.className)}
            />
          )}

          <FilterPanel
            filters={filters}
            onClearAll={handleClearAll}
            isLoading={isLoading}
            disabled={disabled}
            align={align}
          />
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
