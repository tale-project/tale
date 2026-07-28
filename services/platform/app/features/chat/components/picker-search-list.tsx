'use client';

/**
 * A searchable, scrollable option list for the composer picker's expanding
 * sections (models, agents, skills, connectors).
 *
 * Lives inside an open dropdown, so every control is a plain input/button
 * that stops propagation: typing must not reach the menu's typeahead, and
 * toggling a checkbox must not close the menu. Picking a single-select option
 * reports upward so the caller can close the menu itself.
 */

import { Check, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface PickerSearchOption {
  /** Stable identity — also the search haystack when `search` is absent. */
  readonly key: string;
  /** What the row renders. */
  readonly label: ReactNode;
  /** Plain text to match against; defaults to `key`. */
  readonly search?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export function PickerSearchList({
  options,
  emptyHint,
  multiSelect = false,
  searchThreshold = 5,
  onPicked,
}: {
  readonly options: readonly PickerSearchOption[];
  /** Shown when the section has nothing to offer at all. */
  readonly emptyHint: string;
  /** Checkbox semantics (skills, connectors) instead of a single pick. */
  readonly multiSelect?: boolean;
  /** Below this many options the search field is noise, so it is hidden. */
  readonly searchThreshold?: number;
  /** Called after a single-select pick — the caller closes the menu, the way
   * a real menu item would. Ignored while `multiSelect`. */
  readonly onPicked?: () => void;
}) {
  const { t } = useT('chat');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter((option) =>
      (option.search ?? option.key).toLowerCase().includes(needle),
    );
  }, [options, query]);

  if (options.length === 0) {
    return (
      <p className="text-muted-foreground max-w-56 px-2 py-1.5 text-xs leading-snug">
        {emptyHint}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      {options.length >= searchThreshold && (
        <div className="relative px-1 pt-1 pb-1.5">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // The menu owns arrow keys and typeahead; inside the field the
            // keystrokes belong to the field. Escape still bubbles so the
            // menu can close.
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            onClick={(event) => event.stopPropagation()}
            placeholder={t('picker.searchPlaceholder')}
            aria-label={t('picker.searchPlaceholder')}
            className="bg-muted/50 focus:ring-ring h-7 w-full rounded-md pr-2 pl-7 text-xs outline-none focus:ring-1"
          />
        </div>
      )}
      {/* Four rows tall, then it scrolls — a long catalog must never
          push the menu past the viewport. */}
      <div className="max-h-[8.5rem] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            {t('picker.searchEmpty')}
          </p>
        ) : (
          filtered.map((option) => (
            <button
              key={option.key}
              type="button"
              role={multiSelect ? 'menuitemcheckbox' : 'menuitem'}
              {...(multiSelect ? { 'aria-checked': option.selected } : {})}
              disabled={option.disabled}
              // The submenu's dismiss layer reacts to pointerdown, which
              // would tear the row out from under the click — keep the press
              // local and act on the click.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                option.onSelect();
                // Multi-select assembles, so the menu stays open; a single
                // pick is terminal and closes it, like any menu item.
                if (!multiSelect) onPicked?.();
              }}
              className={cn(
                'hover:bg-accent focus:bg-accent flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.selected === true && (
                <Check aria-hidden className="text-primary size-3.5" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
