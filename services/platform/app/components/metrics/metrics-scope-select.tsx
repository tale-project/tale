'use client';

import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { selectTriggerClasses } from '@/app/components/ui/forms/select';
import { cn } from '@/lib/utils/cn';

import type { MetricsScopeOption } from './metrics-scope';

interface MetricsScopeSelectProps {
  /** Already-translated dimension name, e.g. "Project". Prefixes the value. */
  label: string;
  /** The subjects available to scope to. */
  options: ReadonlyArray<MetricsScopeOption>;
  /** Currently scoped subject, or `undefined` while the page is unscoped. */
  value: string | undefined;
  onValueChange: (value: string) => void;
  /** Trigger text while nothing is scoped, e.g. "Select a project". */
  placeholder: string;
  /** Search field placeholder inside the popover. */
  searchPlaceholder: string;
  /** Shown when the search matches nothing (or there are no subjects at all). */
  emptyText: string;
}

/**
 * The always-visible SUBJECT of a metrics page — the dimension the whole view
 * is scoped to (which project's KPIs am I reading?).
 *
 * Deliberately not a section of `MetricsPeriodSelect`'s filter button: a
 * required scope that gates every number on the page can't live behind a
 * control labelled "Filter", where it is neither discoverable from the empty
 * state nor readable once chosen. Optional narrowing dimensions still belong in
 * that one filter button — this is only for the subject itself.
 *
 * Sits at input height (`h-9`) so it lines up with the filter button beside it,
 * the same way a data-table toolbar pairs its search input with filters.
 */
export function MetricsScopeSelect({
  label,
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
}: MetricsScopeSelectProps) {
  const selected = useMemo(
    () =>
      value ? options.find((option) => option.value === value) : undefined,
    [options, value],
  );

  return (
    <SearchableSelect
      align="end"
      value={value ?? null}
      options={options}
      onValueChange={onValueChange}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      aria-label={label}
      trigger={
        <button
          type="button"
          // The trigger states the dimension, so its accessible name carries
          // both halves ("Project: Getting started") rather than the bare value.
          aria-label={selected ? `${label}: ${selected.label}` : placeholder}
          className={cn(
            selectTriggerClasses(),
            // `w-auto` undoes the field-width default: a toolbar control is
            // sized by its content, capped so a long project name truncates
            // instead of pushing the filter button off the header.
            'w-auto min-w-40 max-w-64 gap-2',
          )}
        >
          {selected ? (
            // Text flow, NOT a nested flex row: the trigger's own
            // `[&>span]:line-clamp-1` sets `display:-webkit-box` on this direct
            // child, which silently overrides `flex` and drops the gap — the
            // label and value then render jammed as "ProjectGetting started".
            // A literal separator can't be undone by that cascade, and
            // line-clamp still truncates a long name.
            <span className="min-w-0">
              <span className="text-muted-foreground">{label}</span>
              {': '}
              {selected.label}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </button>
      }
    />
  );
}
