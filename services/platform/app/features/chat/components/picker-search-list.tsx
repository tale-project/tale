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

import { cn } from '@tale/ui/cn';
import { useVirtualList } from '@tale/ui/use-virtual-list';
import { Check, Search } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { rowFocusIndex } from '@/app/features/home/lib/row-navigation';
import { useT } from '@/lib/i18n/client';

export interface PickerSearchOption {
  /** Stable identity — also the search haystack when `search` is absent. */
  readonly key: string;
  /** What the row renders. */
  readonly label: ReactNode;
  /** Plain text to match against; defaults to `key`. */
  readonly search?: string;
  /** Accessible name override — for a row whose visual label carries more
   * than its name (a description line must not bloat what a screen reader
   * announces). */
  readonly ariaLabel?: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter((option) =>
      (option.search ?? option.key).toLowerCase().includes(needle),
    );
  }, [options, query]);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const getItemKey = useCallback(
    (index: number) => filtered[index].key,
    [filtered],
  );
  const enabledIndices = useMemo(
    () => filtered.flatMap((option, index) => (option.disabled ? [] : [index])),
    [filtered],
  );
  const focusIndex =
    focusKey === null
      ? -1
      : filtered.findIndex((option) => option.key === focusKey);
  const virtual = useVirtualList({
    count: filtered.length,
    getScrollElement,
    getItemKey,
    estimateSize: () => 32,
    pinnedIndices: focusIndex === -1 ? [] : [focusIndex],
  });
  useLayoutEffect(() => {
    if (focusKey === null) return;
    const target = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-picker-key="${CSS.escape(focusKey)}"]`,
    );
    if (!target) return;
    target.focus();
    setFocusKey(null);
  }, [focusKey, virtual.items]);

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
            onChange={(event) => {
              setQuery(event.target.value);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
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
      <div
        ref={scrollRef}
        role="group"
        className="max-h-[8.5rem] overflow-y-auto"
        onKeyDown={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLButtonElement)) return;
          const index = Number(target.dataset.index);
          if (!Number.isInteger(index)) return;
          const next = rowFocusIndex(
            event,
            enabledIndices.indexOf(index),
            enabledIndices.length,
          );
          const nextIndex = next === null ? undefined : enabledIndices[next];
          const option =
            nextIndex === undefined ? undefined : filtered[nextIndex];
          if (!option || nextIndex === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          const row = scrollRef.current?.querySelector<HTMLButtonElement>(
            `[data-picker-key="${CSS.escape(option.key)}"]`,
          );
          if (row) row.focus();
          else {
            setFocusKey(option.key);
            virtual.scrollToIndex(nextIndex, { align: 'auto' });
          }
        }}
      >
        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            {t('picker.searchEmpty')}
          </p>
        ) : (
          virtual.items.map((row) => {
            const option = filtered[row.index];
            return (
              <Fragment key={option.key}>
                {row.paddingBefore > 0 && (
                  <div aria-hidden style={{ height: row.paddingBefore }} />
                )}
                <button
                  ref={virtual.measureElement}
                  onFocusCapture={virtual.onFocusCapture}
                  onBlurCapture={virtual.onBlurCapture}
                  data-index={row.index}
                  data-picker-key={option.key}
                  type="button"
                  // Single-select rows are radio items: the chosen state must be
                  // programmatic (aria-checked), not just the visual check glyph.
                  role={multiSelect ? 'menuitemcheckbox' : 'menuitemradio'}
                  aria-checked={option.selected === true}
                  aria-posinset={row.index + 1}
                  aria-setsize={filtered.length}
                  {...(option.ariaLabel !== undefined
                    ? { 'aria-label': option.ariaLabel }
                    : {})}
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
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {option.selected === true && (
                    <Check aria-hidden className="text-primary size-3.5" />
                  )}
                </button>
              </Fragment>
            );
          })
        )}
        {virtual.paddingAfter > 0 && (
          <div aria-hidden style={{ height: virtual.paddingAfter }} />
        )}
      </div>
    </div>
  );
}
