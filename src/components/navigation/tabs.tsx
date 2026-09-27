'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../../lib/cn';
import { DropdownMenu } from '../overlays/dropdown-menu';
import { IconButton } from '../primitives/icon-button';

export interface TabItem {
  value: string;
  label: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
  /** Accessible name for triggers with icon-only labels. */
  ariaLabel?: string;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  listClassName?: string;
  triggerClassName?: string;
  /** Visual style variant */
  variant?: 'pill' | 'underline';
  /**
   * Distribute the tabs evenly across the full row width (`justify-around`)
   * instead of packing them on the left. Useful when the row already
   * occupies a full panel — e.g. a settings drawer's tab strip — where
   * left-packing leaves an unbalanced gap to the right.
   */
  equalWidth?: boolean;
  /** Optional actions rendered to the right of the tab list */
  actions?: ReactNode;
  /**
   * Optional toolbar rendered as its own full-width row between the tab list
   * and the panels — the home for per-view controls (filters on the left,
   * bulk actions on the right) that belong to the content rather than to the
   * strip.
   */
  toolbar?: ReactNode;
  /** Accessible name for the tablist itself (`aria-label` on `TabsPrimitive.List`) — set this when the tab strip has no adjacent visible heading that already names it. */
  listAriaLabel?: string;
  /**
   * When the strip overflows its row, surface every tab in a trailing
   * dropdown and hide the tabs that no longer fit COMPLETELY — a
   * half-clipped label reads as a rendering glitch, so from the first tab
   * whose right edge crosses the row the strip shows nothing, and the menu
   * (not a hidden scroller) is the one path to what doesn't fit. Off by
   * default; pair with `overflowMenuLabel` for a localized trigger label.
   */
  overflowMenu?: boolean;
  /** Accessible label for the overflow-menu trigger. @default 'More' */
  overflowMenuLabel?: string;
  /**
   * Keep every panel MOUNTED and merely hidden while inactive. Radix unmounts
   * inactive tab content by default, which resets any local state a panel
   * holds (an expanded tree, a picked upload target); opt in when the panels
   * are stateful editors rather than cheap read views.
   */
  keepMounted?: boolean;
}

// `min-w-0` lets the flex child shrink past its content width so the
// horizontal scroller engages on narrow viewports (without it the row
// forces the parent to grow). Items pack `justify-start` by default so
// the locale-style 3-tab case doesn't stretch across the full row; the
// `equalWidth` variant exists for surfaces (provider drawer) that want
// each tab to take an even share of the available width.
//
// Width differs per variant:
//   - pill: `inline-flex w-fit` — the rounded `bg-muted` row hugs the
//     pills and doesn't bleed into empty space to the right of the row.
//   - underline: `flex flex-1` — the bottom border spans the full row
//     width so the underline reads as the page's section divider.
const listVariants = cva(
  'scrollbar-hide text-muted-foreground max-w-full min-w-0 items-center overflow-x-auto',
  {
    variants: {
      variant: {
        pill: 'bg-muted inline-flex w-fit rounded-lg p-1',
        underline: 'border-border flex flex-1 gap-4 border-b',
      },
      equalWidth: {
        true: 'justify-around',
        false: 'justify-start',
      },
    },
    defaultVariants: { variant: 'pill', equalWidth: false },
  },
);

const triggerVariants = cva(
  'focus-visible:ring-ring inline-flex items-center justify-center text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        pill: 'data-[state=active]:bg-tab data-[state=active]:text-foreground rounded-md px-3 py-1 transition-all data-[state=active]:shadow-sm',
        underline:
          'data-[state=active]:border-primary data-[state=active]:text-foreground relative border-b-2 border-transparent px-1 pb-2 transition-colors',
      },
    },
    defaultVariants: { variant: 'pill' },
  },
);

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
  listClassName,
  triggerClassName,
  variant = 'pill',
  equalWidth = false,
  actions,
  toolbar,
  listAriaLabel,
  overflowMenu = false,
  overflowMenuLabel = 'More',
  keepMounted = false,
}: TabsProps) {
  const hasContent = items.some((item) => item.content !== undefined);

  // The overflow menu needs to know the active tab to mark it, and to switch
  // tabs on selection even when the caller left the Tabs uncontrolled — so
  // with `overflowMenu` the primitive runs controlled off this state (seeded
  // from `defaultValue`), and callers that do control `value` still win.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  /** Index of the first tab that no longer fits completely; it and every
   *  tab after it render `invisible` (layout kept, so measurements stay
   *  stable) while the menu carries them. */
  const [hiddenFrom, setHiddenFrom] = useState<number | null>(null);
  const [innerValue, setInnerValue] = useState(defaultValue);
  const currentValue = value ?? innerValue;
  const selectValue = (next: string) => {
    setInnerValue(next);
    onValueChange?.(next);
  };

  const selectedHidden =
    hiddenFrom !== null &&
    currentValue !== undefined &&
    items.findIndex((item) => item.value === currentValue) >= hiddenFrom;

  useLayoutEffect(() => {
    if (!overflowMenu) return undefined;
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => {
      // +1 absorbs sub-pixel rounding so a snug fit doesn't flicker the menu.
      const overflows = el.scrollWidth > el.clientWidth + 1;
      setOverflowing(overflows);
      if (!overflows) {
        setHiddenFrom(null);
        return;
      }
      // A tab that does not fit completely is hidden completely: find the
      // first trigger whose right edge crosses the row's visible width.
      const left = el.getBoundingClientRect().left;
      const limit = el.clientWidth + 1;
      const triggers = Array.from(
        el.querySelectorAll<HTMLElement>('[role="tab"]'),
      );
      const first = triggers.findIndex(
        (trigger) => trigger.getBoundingClientRect().right - left > limit,
      );
      setHiddenFrom(first === -1 ? null : first);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [overflowMenu, items]);

  return (
    <TabsPrimitive.Root
      {...(overflowMenu
        ? { value: currentValue, onValueChange: selectValue }
        : { value, defaultValue, onValueChange })}
      className={className}
    >
      <div className="flex min-w-0 items-center justify-between gap-4">
        <TabsPrimitive.List
          ref={listRef}
          aria-label={listAriaLabel}
          className={cn(
            listVariants({ variant, equalWidth }),
            // With the menu as the canonical path to overflowing tabs, the
            // strip must not scroll — a scrolled-into-view tab would be one
            // of the deliberately invisible ones.
            overflowMenu && 'overflow-x-hidden',
            listClassName,
          )}
        >
          {items.map((item, index) => (
            <TabsPrimitive.Trigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              aria-label={item.ariaLabel}
              className={cn(
                triggerVariants({ variant }),
                // `invisible`, not `hidden`: layout is kept so the overflow
                // measurement stays stable, and visibility removes the
                // trigger from focus and the accessibility tree.
                hiddenFrom !== null && index >= hiddenFrom && 'invisible',
                triggerClassName,
              )}
            >
              {item.label}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        {overflowMenu && overflowing && (
          <DropdownMenu
            align="end"
            trigger={
              <IconButton
                icon={ChevronDown}
                variant="ghost"
                size="sm"
                aria-label={overflowMenuLabel}
                // A hidden tab cannot show its own selected state (it sits
                // past the clip edge), so when the CURRENT tab is overflowed
                // the trigger stands in for it: active-tab styling plus
                // aria-current, or the strip would read as "nothing
                // selected".
                aria-current={selectedHidden ? 'true' : undefined}
                className={cn(
                  selectedHidden && 'bg-tab text-foreground shadow-sm',
                )}
              />
            }
            items={[
              items.map((item) => ({
                type: 'item' as const,
                label: item.ariaLabel ?? item.label,
                disabled: item.disabled,
                selected: item.value === currentValue,
                onClick: () => selectValue(item.value),
              })),
            ]}
          />
        )}
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {toolbar && <div className="mt-4">{toolbar}</div>}
      {hasContent &&
        items.map(
          (item) =>
            item.content !== undefined && (
              <TabsPrimitive.Content
                key={item.value}
                value={item.value}
                // `forceMount` keeps inactive panels alive; Radix still
                // stamps data-state, so hiding is pure CSS.
                {...(keepMounted && { forceMount: true as const })}
                className={cn(
                  'focus-visible:ring-ring mt-5 flex min-h-0 flex-1 flex-col focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                  keepMounted && 'data-[state=inactive]:hidden',
                )}
              >
                {item.content}
              </TabsPrimitive.Content>
            ),
        )}
    </TabsPrimitive.Root>
  );
}
