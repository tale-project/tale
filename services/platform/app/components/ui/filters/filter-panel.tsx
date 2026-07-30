'use client';

import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import { Circle } from 'lucide-react';
import { useState } from 'react';

import { FilterButton } from '@/app/components/ui/filters/filter-button';
import { FilterSection } from '@/app/components/ui/filters/filter-section';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * THE filter affordance: one button that opens every facet group at once,
 * collapsed by default, with the active-selection dot and "Clear all" in the
 * panel header.
 *
 * It lives here rather than inside `DataTableFilters` because it is not a table
 * concern — the card catalogs (AI providers, connectors, the skill library) need
 * the same control, and before this split they each grew their own row of
 * `MultiSelect` dropdowns instead. Table and catalog now render the same button,
 * the same panel, and the same disabled rule, so "filter" looks and behaves
 * identically wherever it appears.
 */

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
   * The filter's resting selection — for a mandatory filter (one that always
   * carries a value, like a metrics period), the value it falls back to.
   * A selection equal to it does not count as ACTIVE: no indicator dot, and
   * "Clear all" restores it instead of emptying the filter.
   */
  defaultValues?: string[];
  /**
   * Number of columns for the options grid.
   * @default 1
   */
  columns?: 1 | 2;
  /** Whether multiple options can be selected (default: false) */
  multiSelect?: boolean;
  /**
   * This filter can WIDEN the result set beyond the default view (e.g.
   * "show archived" reveals rows the default query hides). Its presence keeps
   * the filter affordance enabled on an empty unfiltered list — rows may
   * exist outside the default set, so the set isn't guaranteed empty.
   */
  widensResultSet?: boolean;
}

/**
 * Whether a filter is narrowing anything beyond its resting state. Order is
 * ignored so a multi-select reads as inactive however its defaults were
 * re-ticked.
 */
export function isFilterActive(
  filter: Pick<FilterConfig, 'selectedValues' | 'defaultValues'>,
): boolean {
  const defaults = new Set(filter.defaultValues ?? []);
  if (filter.selectedValues.length !== defaults.size) return true;
  return filter.selectedValues.some((value) => !defaults.has(value));
}

/**
 * The shared disabled rule for a filter affordance: nothing exists to narrow,
 * and no filter is currently doing the narrowing. Loading never disables — the
 * set isn't known yet — and a filtered-to-empty result stays enabled so the
 * reader can undo it.
 *
 * A widening filter keeps the affordance usable on an empty unfiltered set,
 * because items may exist outside the default view.
 */
export function isFilterAffordanceDisabled({
  isLoading = false,
  itemCount,
  hasActiveFilters,
  filters,
}: {
  isLoading?: boolean;
  itemCount: number;
  hasActiveFilters: boolean;
  filters?: readonly FilterConfig[];
}): boolean {
  if (isLoading || itemCount > 0 || hasActiveFilters) return false;
  return !filters?.some((filter) => filter.widensResultSet);
}

interface FilterPanelProps {
  filters: readonly FilterConfig[];
  /**
   * Runs when the panel's "Clear all" is pressed. The caller owns it because
   * clearing usually reaches past the facets — a search box, a date range.
   */
  onClearAll: () => void;
  /** Swap the icon for a spinner while the facet options are still resolving. */
  isLoading?: boolean;
  /**
   * Render the button disabled and suppress the popover — for an empty set with
   * no active filters (see `isFilterAffordanceDisabled`). A disabled button on
   * the `Popover` trigger is NOT sufficient: the trigger's wrapper still toggles
   * the popover, so the panel has to be left out entirely.
   */
  disabled?: boolean;
  /**
   * Which edge of the button the panel pins to. Keep `'start'` for
   * left-anchored toolbars; pass `'end'` when the button sits at the right edge
   * of the page, so the panel doesn't run off-viewport.
   */
  align?: 'start' | 'end';
}

export function FilterPanel({
  filters,
  onClearAll,
  isLoading = false,
  disabled = false,
  align = 'start',
}: FilterPanelProps) {
  const { t } = useT('common');
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

  if (filters.length === 0) return null;

  const activeFilterCount = filters.filter(isFilterActive).length;

  if (disabled) {
    return (
      <FilterButton hasActiveFilters={false} isLoading={isLoading} disabled />
    );
  }

  const handleFilterChange = (
    filter: FilterConfig,
    value: string,
    checked: boolean,
  ) => {
    filter.onChange(
      checked
        ? [...filter.selectedValues, value]
        : filter.selectedValues.filter((entry) => entry !== value),
    );
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      // Never a modal layer: a modal popover marks the rest of the page
      // aria-hidden, so the grid it narrows would vanish from the accessibility
      // tree while the panel is open.
      modal={false}
      align={align}
      onOpenAutoFocus={(e) => e.preventDefault()}
      contentClassName="bg-card flex max-h-[min(32rem,calc(100dvh-2rem))] flex-col overflow-hidden p-0"
      trigger={
        <FilterButton
          hasActiveFilters={activeFilterCount > 0}
          isLoading={isLoading}
        />
      }
    >
      <div className="border-border flex shrink-0 items-center justify-between border-b p-3">
        <Text as="span" variant="label" className="text-sm">
          {t('labels.filters')}
        </Text>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => {
              onClearAll();
              setIsOpen(false);
            }}
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
            hasSelection={!filter.multiSelect && isFilterActive(filter)}
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
                          handleFilterChange(filter, option.value, !!checked)
                        }
                      />
                      <Text as="span" variant="muted" className="font-medium">
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
                  const isSelected = filter.selectedValues[0] === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() =>
                        filter.onChange(
                          isSelected
                            ? (filter.defaultValues ?? [])
                            : [option.value],
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
                      <Text as="span" variant="muted" className="font-medium">
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
  );
}
