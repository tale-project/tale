'use client';

import { icons as lucideIcons } from '@iconify-json/lucide';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Button } from '@tale/ui/button';
import { Search } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';

import { ConfigIcon } from '@/app/components/catalog/config-icon';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/** Grid width; the arrow keys move by ±1 and ±COLUMNS. */
const COLUMNS = 8;
/** Render at most this many matches — filtering beats scrolling 1800 cells. */
const MAX_RENDERED = 96;

const ALL_ICON_NAMES: readonly string[] = Object.keys(lucideIcons.icons).sort();

/**
 * Pick a card icon from the bundled lucide set (the one set `ConfigIcon`
 * resolves offline). A searchable popover grid: type to narrow, arrows to
 * move, Enter to pick, the leading cell clears. Writes `lucide:<name>` —
 * exactly the frontmatter shape — and leaves an icon from another set
 * untouched until the user actively picks a replacement.
 */
export function SkillIconPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (icon: string | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useT('skills');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const names = needle
      ? ALL_ICON_NAMES.filter((name) => name.includes(needle))
      : ALL_ICON_NAMES;
    return names.slice(0, MAX_RENDERED);
  }, [query]);
  const overflow =
    query.trim() === ''
      ? ALL_ICON_NAMES.length - matches.length
      : Math.max(
          0,
          ALL_ICON_NAMES.filter((name) =>
            name.includes(query.trim().toLowerCase()),
          ).length - matches.length,
        );

  // Cell 0 is the "no icon" clear option; icons follow.
  const cellCount = matches.length + 1;

  const pick = (index: number) => {
    if (index === 0) {
      onChange(undefined);
    } else {
      const name = matches[index - 1];
      if (name === undefined) return;
      onChange(`lucide:${name}`);
    }
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const move = (delta: number) => {
      e.preventDefault();
      setHighlighted((current) =>
        Math.min(cellCount - 1, Math.max(0, current + delta)),
      );
    };
    if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowDown') move(COLUMNS);
    else if (e.key === 'ArrowUp') move(-COLUMNS);
    else if (e.key === 'Home') {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlighted(cellCount - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(highlighted);
    }
  };

  const cellId = (index: number) => `${listboxId}-cell-${index}`;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
          setHighlighted(0);
        }
      }}
      modal
    >
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          aria-label={t('iconPicker.trigger')}
          fullWidth
          className="gap-2"
        >
          <ConfigIcon icon={value} className="size-4" />
          {t('iconPicker.trigger')}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="bg-popover text-popover-foreground z-50 w-80 rounded-md border shadow-md outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="border-border flex items-center gap-2 border-b p-3">
            <Search
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('iconPicker.searchPlaceholder')}
              className="placeholder:text-muted-foreground flex-1 bg-transparent text-base outline-none"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={cellId(highlighted)}
              aria-autocomplete="list"
              aria-label={t('iconPicker.searchPlaceholder')}
            />
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label={t('iconPicker.label')}
            className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto p-2"
          >
            <button
              type="button"
              id={cellId(0)}
              role="option"
              aria-selected={value === undefined}
              title={t('iconPicker.none')}
              aria-label={t('iconPicker.none')}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(0);
              }}
              onMouseEnter={() => setHighlighted(0)}
              className={cn(
                'text-muted-foreground flex size-8 items-center justify-center rounded-md text-xs',
                highlighted === 0 && 'bg-accent text-accent-foreground',
              )}
            >
              —
            </button>
            {matches.map((name, index) => {
              const cell = index + 1;
              const iconId = `lucide:${name}`;
              return (
                <button
                  key={name}
                  type="button"
                  id={cellId(cell)}
                  role="option"
                  aria-selected={value === iconId}
                  title={name}
                  aria-label={name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(cell);
                  }}
                  onMouseEnter={() => setHighlighted(cell)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md',
                    highlighted === cell && 'bg-accent text-accent-foreground',
                    value === iconId && 'ring-ring ring-1',
                  )}
                >
                  <ConfigIcon icon={iconId} className="size-4" />
                </button>
              );
            })}
          </div>
          {overflow > 0 && (
            <p className="text-muted-foreground border-border border-t p-2 text-center text-xs">
              {t('iconPicker.refine', { count: overflow })}
            </p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
