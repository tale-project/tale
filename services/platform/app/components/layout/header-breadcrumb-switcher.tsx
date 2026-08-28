'use client';

import { ChevronDown, type LucideIcon } from 'lucide-react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { cn } from '@/lib/utils/cn';

interface HeaderBreadcrumbSwitcherProps {
  /** Option value of the entity currently open. */
  value: string;
  /** The sibling entities to offer; the current one should be among them. */
  options: readonly SearchableSelectOption[];
  /**
   * The current entity's name — the visible leaf text, and the plain fallback
   * rendered while `options` is empty.
   */
  displayName: string;
  /** Heading above the search field (e.g. "Switch project"). */
  title: string;
  searchPlaceholder: string;
  /** Shown when the search matches nothing. */
  emptyText: string;
  /**
   * Accessible name of the trigger — and, because `HeaderBreadcrumbs` wraps
   * its leaf in the page's `h1`, of that heading too (e.g.
   * "Switch project, current: Acme").
   */
  ariaLabel: string;
  /** Called with the picked option's value; never called for the current one. */
  onValueChange: (value: string) => void;
  /** Optional icon before the name (e.g. an aggregate-scope marker). */
  leadingIcon?: LucideIcon;
  /** Custom option filter — defaults to label + description matching. */
  filterFn?: (option: SearchableSelectOption, query: string) => boolean;
}

/**
 * The breadcrumb leaf for a detail page whose entity has siblings: the current
 * name opens a searchable switcher of siblings so the operator can jump
 * between them without returning to the list. Projects and automations render
 * this same primitive; feature adapters own the option list and where a pick
 * navigates. While the sibling list is empty (or still loading) the plain
 * name renders instead — no dead chevron. i18n-agnostic: callers pass
 * already-translated strings.
 */
export function HeaderBreadcrumbSwitcher({
  value,
  options,
  displayName,
  title,
  searchPlaceholder,
  emptyText,
  ariaLabel,
  onValueChange,
  leadingIcon: LeadingIcon,
  filterFn,
}: HeaderBreadcrumbSwitcherProps) {
  if (options.length === 0) {
    return <>{displayName}</>;
  }

  return (
    <SearchableSelect
      variant="switcher"
      align="start"
      contentClassName="min-w-64"
      value={value}
      options={options}
      title={title}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      aria-label={ariaLabel}
      {...(filterFn !== undefined && { filterFn })}
      onValueChange={(next) => {
        if (next === value) return;
        onValueChange(next);
      }}
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm',
            'hover:text-muted-foreground transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          )}
        >
          {LeadingIcon && (
            <LeadingIcon
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 truncate">{displayName}</span>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </button>
      }
    />
  );
}
