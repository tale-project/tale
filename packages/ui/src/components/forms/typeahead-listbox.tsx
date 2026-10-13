'use client';

/**
 * The picker a typeahead field opens over its own text — the people an `@`
 * finds in a mention field, the skills a `/` finds in the chat composer.
 *
 * The keyboard stays in the field: it moves through the options by
 * `aria-activedescendant` (the field passes `optionId(highlight)` and
 * `listboxId` as its `aria-activedescendant` and `aria-controls`), Up/Down,
 * Enter or Tab and Escape being the field's to handle. A pointer picks on
 * mousedown, before the field would blur and close the picker. With nothing
 * to offer it says so instead of listing.
 */

import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { useEffect, useRef, type ReactNode } from 'react';

export interface TypeaheadListboxOption {
  /** Stable identity, for React. */
  readonly key: string;
  readonly name: ReactNode;
  /** A muted second line under the name. */
  readonly caption?: ReactNode;
  /** Drawn before the name: an avatar, an icon. */
  readonly leading?: ReactNode;
}

export interface TypeaheadListboxProps {
  readonly listboxId: string;
  readonly optionId: (index: number) => string;
  /** The listbox's accessible name. */
  readonly label: string;
  /** What the picker says when nothing matches. */
  readonly emptyLabel: ReactNode;
  readonly options: readonly TypeaheadListboxOption[];
  /** The option the keyboard is on. */
  readonly highlight: number;
  /** Where the picker opens: a field at the foot of a panel wants 'above',
   * one near the top of a dialog 'below'. */
  readonly placement?: 'above' | 'below';
  readonly onPick: (index: number) => void;
  readonly onHighlight: (index: number) => void;
}

export function TypeaheadListbox({
  listboxId,
  optionId,
  label,
  emptyLabel,
  options,
  highlight,
  placement = 'above',
  onPick,
  onHighlight,
}: TypeaheadListboxProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  return (
    <div
      className={cn(
        'border-border bg-popover text-popover-foreground absolute right-0 left-0 z-50 overflow-hidden rounded-xl border shadow-lg',
        placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
      )}
    >
      {options.length === 0 ? (
        <Text
          as="div"
          variant="caption"
          className="text-muted-foreground px-3 py-2.5"
        >
          {emptyLabel}
        </Text>
      ) : (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="max-h-56 overflow-y-auto py-1"
        >
          {options.map((option, index) => {
            const active = index === highlight;
            return (
              <div
                key={option.key}
                id={optionId(index)}
                role="option"
                // The keyboard stays in the field and moves through the
                // options by aria-activedescendant.
                tabIndex={-1}
                aria-selected={active}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 px-3 py-1.5',
                  active && 'bg-accent text-accent-foreground',
                )}
                // Picks on mousedown, before the field would blur and
                // close the picker.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(index);
                }}
                onMouseEnter={() => onHighlight(index)}
              >
                {option.leading}
                <span className="min-w-0 flex-1">
                  <Text as="span" variant="label" className="block truncate">
                    {option.name}
                  </Text>
                  {option.caption !== undefined && (
                    <Text
                      as="span"
                      variant="caption"
                      className="text-muted-foreground block truncate"
                    >
                      {option.caption}
                    </Text>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
