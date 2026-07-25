'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { TooltipContent } from '@tale/ui/tooltip';
import { Check, ChevronDown, Circle, Search } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/utils/cn';

import { Label } from './label';
import { selectTriggerClasses } from './select';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /**
   * Optional inline badge rendered right after the label (e.g. a provider
   * tag on a model row). Wraps onto a second line when the label is long.
   */
  labelBadge?: ReactNode;
  description?: string;
  disabled?: boolean;
  /** Non-selectable section header row (skipped by keyboard navigation). */
  isSectionHeader?: boolean;
}

export interface SearchableSelectProps {
  /** The currently selected value */
  value: string | null;
  /** Called when the user selects an option */
  onValueChange: (value: string) => void;
  /** Array of options to display */
  options: ReadonlyArray<SearchableSelectOption>;
  /**
   * Custom trigger element. If omitted, a default trigger visually identical
   * to `Select` is rendered using `label`, `placeholder`, `size`, etc.
   */
  trigger?: ReactNode;
  /** Label rendered above the default trigger. Ignored when `trigger` is provided. */
  label?: ReactNode;
  /** Placeholder shown on the default trigger when no value is selected. */
  placeholder?: ReactNode;
  /** Marks the default trigger as invalid (adds error ring + aria-invalid). */
  error?: boolean;
  /** Description text rendered below the default trigger. */
  description?: ReactNode;
  /** Adds a required asterisk next to the default trigger's label. */
  required?: boolean;
  /** Disables the default trigger. Ignored when `trigger` is provided. */
  disabled?: boolean;
  /** Id for the default trigger (used for label association). */
  id?: string;
  /** Additional className merged onto the default trigger. */
  triggerClassName?: string;
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  /** Text to display when no options match the search */
  emptyText?: string;
  /** Optional footer content (e.g., action button) */
  footer?: ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Popover alignment relative to trigger */
  align?: 'start' | 'center' | 'end';
  /** Popover side */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Popover side offset in pixels */
  sideOffset?: number;
  /** Additional className for the popover content */
  contentClassName?: string;
  /** Accessible label for the listbox */
  'aria-label'?: string;
  /** Custom filter function; defaults to case-insensitive match on label + description */
  filterFn?: (option: SearchableSelectOption, query: string) => boolean;
  /** Show a radio indicator instead of a check icon for the selected state */
  showRadio?: boolean;
  /** Optional action element rendered on the right side of each option */
  optionAction?: (option: SearchableSelectOption) => ReactNode;
  /**
   * How an option's `description` is presented.
   *   - `'inline'` (default): rendered as a caption row below the label —
   *     preferred for catalog pickers (agents, models, project lists) where
   *     the description helps users choose without an extra hover step.
   *   - `'tooltip'`: hidden in the row, surfaced in a Radix tooltip when the
   *     row is hovered or keyboard-highlighted — reserve for dense toolbars
   *     where inline prose would blow the list out vertically.
   *
   * @default 'inline'
   */
  descriptionMode?: 'inline' | 'tooltip';
  /**
   * Optional hover/focus tooltip for the trigger. When set, the trigger is
   * composed with a Radix tooltip (both triggers collapse onto the same DOM
   * node via `asChild`), so the popover still opens on click while the tooltip
   * explains the control on hover. Useful for compact toolbar triggers.
   */
  tooltip?: ReactNode;
  /** Side the tooltip opens on. @default 'top' */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Render the popover as a Radix modal layer. Required when the select sits
   * inside a modal Dialog: the dialog's scroll lock swallows wheel events over
   * the (portaled) popover, so a long option list won't wheel-scroll. A modal
   * popover registers its own scroll-lock shard, restoring scrolling.
   * @default false
   */
  modal?: boolean;
  /**
   * Optional heading above the search field (e.g. "Switch agent"). Used by
   * breadcrumb entity switchers; ignored when empty.
   */
  title?: ReactNode;
  /**
   * Visual packing for the popover.
   *   - `'default'`: catalog picker (agents, models) — search strip, trailing
   *     check, rounded option rows.
   *   - `'switcher'`: breadcrumb entity switcher — titled panel, bordered
   *     search, limited list height, selected row with leading check + left
   *     accent bar.
   *
   * @default 'default'
   */
  variant?: 'default' | 'switcher';
}

// Radix Popover — unlike Radix Select — does NOT auto-size its content to the
// trigger. Bind the min-width to `--radix-popover-trigger-width` so a full-width
// field trigger (e.g. the install wizard's project picker) gets a full-width
// dropdown instead of a 14.5rem one centered under it. `max()` keeps the 14.5rem
// floor so compact toolbar triggers (agent/model pickers) still open a usable
// width; content can grow it wider than either bound.
const CONTENT_CLASSES =
  'z-50 min-w-[max(14.5rem,var(--radix-popover-trigger-width))] rounded-lg ring-1 ring-border bg-popover text-popover-foreground dark:bg-muted shadow-md outline-none p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2';

function defaultFilterFn(option: SearchableSelectOption, query: string) {
  const lower = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(lower) ||
    (option.description?.toLowerCase().includes(lower) ?? false)
  );
}

/**
 * Filter a flat option list while preserving section structure: never match
 * headers against the query; keep a header only when its section has ≥1
 * matching item. Leading unsectioned items filter normally.
 */
function filterOptionsWithSections(
  options: ReadonlyArray<SearchableSelectOption>,
  query: string,
  filter: (option: SearchableSelectOption, query: string) => boolean,
): SearchableSelectOption[] {
  const result: SearchableSelectOption[] = [];
  let i = 0;
  while (i < options.length) {
    const current = options[i];
    if (!current) {
      i++;
      continue;
    }
    if (current.isSectionHeader) {
      const header = current;
      i++;
      const matched: SearchableSelectOption[] = [];
      while (i < options.length && !options[i]?.isSectionHeader) {
        const item = options[i];
        if (item && filter(item, query)) matched.push(item);
        i++;
      }
      if (matched.length > 0) {
        result.push(header, ...matched);
      }
      continue;
    }
    // Unsectioned leading (or mid-list) item — filter on its own.
    if (filter(current, query)) result.push(current);
    i++;
  }
  return result;
}

function findNextEnabledIndex(
  options: ReadonlyArray<SearchableSelectOption>,
  current: number,
  direction: 1 | -1,
) {
  const len = options.length;
  if (len === 0) return -1;
  let index = (current + direction + len) % len;
  let iterations = 0;
  while (
    (options[index]?.disabled || options[index]?.isSectionHeader) &&
    iterations < len
  ) {
    index = (index + direction + len) % len;
    iterations++;
  }
  return options[index]?.disabled || options[index]?.isSectionHeader
    ? -1
    : index;
}

// Plain control — the real default trigger (or caller-supplied `trigger`) +
// searchable popover (+ optional label/description). No skeleton logic.
function SearchableSelectBase({
  value,
  onValueChange,
  options,
  trigger,
  label,
  placeholder,
  error,
  description,
  required,
  disabled,
  id: providedId,
  triggerClassName,
  searchPlaceholder,
  emptyText,
  footer,
  open: controlledOpen,
  onOpenChange,
  align = 'center',
  side,
  sideOffset = 4,
  contentClassName,
  'aria-label': ariaLabel,
  filterFn,
  showRadio,
  optionAction,
  descriptionMode = 'inline',
  tooltip,
  tooltipSide = 'top',
  modal = false,
  title,
  variant = 'default',
}: SearchableSelectProps) {
  const isSwitcher = variant === 'switcher';
  const instanceId = useId();
  const listboxId = `${instanceId}-listbox`;
  const optionId = (index: number) => `${instanceId}-option-${index}`;
  const triggerId = providedId ?? `${instanceId}-trigger`;
  const descriptionId = `${instanceId}-description`;

  const selectedOption = useMemo(
    () => (value ? options.find((o) => o.value === value) : undefined),
    [value, options],
  );

  const defaultTrigger = trigger ?? (
    <button
      type="button"
      id={triggerId}
      disabled={disabled}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(selectTriggerClasses({ error }), triggerClassName)}
    >
      <span className={cn(!selectedOption && 'text-muted-foreground')}>
        {selectedOption ? selectedOption.label : placeholder}
      </span>
      <ChevronDown className="size-4 opacity-50" aria-hidden="true" />
    </button>
  );

  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Controlled state for the optional trigger tooltip. Closing the popover
  // restores focus to the trigger, which Radix Tooltip reads as a
  // focus-to-open and flashes the tooltip over the value the user just picked.
  // `suppressTooltipRef` is a one-shot guard armed on popover close to swallow
  // exactly that focus-restore open.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const suppressTooltipRef = useRef(false);

  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const filter = filterFn ?? defaultFilterFn;

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    return filterOptionsWithSections(options, search, filter);
  }, [options, search, filter]);

  const initializeHighlight = useCallback(() => {
    if (filteredOptions.length === 0) return;
    // Land on the first *selectable* row — never a section header (index 0 is a
    // header in sectioned pickers, which breaks aria-activedescendant + Enter).
    const firstEnabled = findNextEnabledIndex(filteredOptions, -1, 1);
    if (value) {
      const idx = filteredOptions.findIndex((o) => o.value === value);
      setHighlightedIndex(idx >= 0 ? idx : firstEnabled);
    } else {
      setHighlightedIndex(firstEnabled);
    }
  }, [value, filteredOptions]);

  useEffect(() => {
    setHighlightedIndex(findNextEnabledIndex(filteredOptions, -1, 1));
  }, [filteredOptions]);

  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen) {
        setSearch('');
        // The popover restores focus to the trigger on close, which Radix
        // Tooltip reads as a focus-to-open and flashes the tooltip over the
        // value just picked. Arm a one-shot guard so that focus-driven open is
        // swallowed (see the Root's onOpenChange). The focus restore is delayed
        // until the close ANIMATION finishes (Radix keeps the content mounted
        // for the ~150ms `animate-out`), so the guard can't be cleared on the
        // next tick — it must outlive the animation. The one-shot consumes the
        // restore whenever it lands; this timer is only a backstop that releases
        // the guard if no focus restore ever fires (e.g. dismissed by a click
        // far from the trigger), so a later genuine hover still works.
        suppressTooltipRef.current = true;
        setTooltipOpen(false);
        window.setTimeout(() => {
          suppressTooltipRef.current = false;
        }, 500);
      }
    },
    [setIsOpen],
  );

  const handleSelect = useCallback(
    (optionValue: string) => {
      onValueChange(optionValue);
      handleOpenChange(false);
    },
    [onValueChange, handleOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const len = filteredOptions.length;
      if (len === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = findNextEnabledIndex(
            filteredOptions,
            highlightedIndex,
            1,
          );
          if (next >= 0) setHighlightedIndex(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = findNextEnabledIndex(
            filteredOptions,
            highlightedIndex,
            -1,
          );
          if (prev >= 0) setHighlightedIndex(prev);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const option = filteredOptions[highlightedIndex];
          if (option && !option.disabled && !option.isSectionHeader) {
            handleSelect(option.value);
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          const first = findNextEnabledIndex(filteredOptions, -1, 1);
          if (first >= 0) setHighlightedIndex(first);
          break;
        }
        case 'End': {
          e.preventDefault();
          const last = findNextEnabledIndex(filteredOptions, len, -1);
          if (last >= 0) setHighlightedIndex(last);
          break;
        }
      }
    },
    [filteredOptions, highlightedIndex, handleSelect],
  );

  const popoverTrigger = (
    <PopoverPrimitive.Trigger asChild>
      {defaultTrigger}
    </PopoverPrimitive.Trigger>
  );

  const popover = (
    <PopoverPrimitive.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      modal={modal}
    >
      {tooltip ? (
        // Radix's documented "tooltip on a popover trigger" composition: both
        // `asChild` triggers collapse onto the same node, so the popover opens
        // on click while the tooltip shows on hover/focus.
        <TooltipPrimitive.Provider delayDuration={300}>
          <TooltipPrimitive.Root
            // Controlled so the tooltip is forced shut while the popover is
            // open and during the focus-restore that follows its close.
            open={tooltipOpen && !isOpen}
            onOpenChange={(next) => {
              if (next && suppressTooltipRef.current) {
                suppressTooltipRef.current = false;
                return;
              }
              setTooltipOpen(next);
            }}
          >
            <TooltipPrimitive.Trigger asChild>
              {popoverTrigger}
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              {/* collisionPadding keeps the tooltip off the viewport edge so it
                  can't visually overlap adjacent controls in dense toolbars. */}
              <TooltipContent side={tooltipSide} collisionPadding={8}>
                {tooltip}
              </TooltipContent>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
      ) : (
        popoverTrigger
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={cn(
            CONTENT_CLASSES,
            isSwitcher && 'overflow-hidden',
            contentClassName,
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
            initializeHighlight();
          }}
        >
          <div
            className={cn(
              isSwitcher
                ? 'border-border flex flex-col border-b'
                : 'border-border flex items-center gap-2 border-b p-3',
            )}
          >
            {title != null && title !== '' && (
              <div
                className={cn(
                  'text-foreground text-sm font-semibold',
                  // More inset from the panel edge than the search row below.
                  isSwitcher && 'px-4 pt-3 pb-2',
                )}
              >
                {title}
              </div>
            )}
            <div
              className={cn(
                // Tighter inset from the panel edge than the title above.
                isSwitcher && 'px-2 pb-2',
                isSwitcher && (title == null || title === '') && 'pt-2',
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-2',
                  isSwitcher
                    ? 'border-border bg-[color:var(--color-bg-base)] focus-within:border-[color:var(--color-accent-base)] focus-within:ring-[color:var(--color-accent-base)]/30 rounded-md border px-2.5 py-1.5 focus-within:ring-2'
                    : undefined,
                )}
              >
                <Search
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  type="text"
                  role="combobox"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  // text-base (≥16px) prevents iOS focus-zoom; md:text-sm keeps
                  // the compact desktop density.
                  className="placeholder:text-muted-foreground flex-1 bg-transparent text-base outline-none md:text-sm"
                  aria-expanded={isOpen}
                  aria-controls={listboxId}
                  aria-activedescendant={
                    filteredOptions.length > 0
                      ? optionId(highlightedIndex)
                      : undefined
                  }
                  aria-autocomplete="list"
                  aria-label={searchPlaceholder}
                />
              </div>
            </div>
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              'overflow-y-auto',
              // Switcher stays compact so a long sibling list doesn't fill the
              // viewport; catalog pickers keep the taller default.
              isSwitcher ? 'max-h-60' : 'max-h-[20rem] p-1',
            )}
          >
            {filteredOptions.map((option, index) => (
              <SearchableSelectOptionItem
                key={option.value}
                option={option}
                index={index}
                id={optionId(index)}
                isSelected={value === option.value}
                isHighlighted={highlightedIndex === index}
                onSelect={handleSelect}
                onMouseEnter={setHighlightedIndex}
                showRadio={showRadio}
                descriptionMode={descriptionMode}
                action={optionAction?.(option)}
                variant={variant}
              />
            ))}

            {filteredOptions.length === 0 && emptyText && (
              <Text
                as="div"
                variant="muted"
                align="center"
                className="px-3 py-4"
              >
                {emptyText}
              </Text>
            )}
          </div>

          {footer && <div className="border-border border-t p-1">{footer}</div>}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );

  if (!label && !description) {
    return popover;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label htmlFor={triggerId} required={required} error={error}>
          {label}
        </Label>
      )}
      {popover}
      {description && (
        <Description id={descriptionId}>{description}</Description>
      )}
    </div>
  );
}

/**
 * Skeleton-aware SearchableSelect. Inside a `<Skeletonize loading>` it masks
 * the plain control by rendering it inside a `<SkeletonBox>` — laid out
 * invisibly to set the exact size, pulse overlay on top — so the skeleton can
 * never drift. Only the DEFAULT trigger is masked: when a custom `trigger` is
 * supplied the caller owns its own skeleton, so it renders normally.
 */
export function SearchableSelect(props: SearchableSelectProps) {
  const loading = useSkeleton();
  if (loading && !props.trigger) {
    return (
      <SkeletonBox>
        <SearchableSelectBase {...props} />
      </SkeletonBox>
    );
  }
  return <SearchableSelectBase {...props} />;
}

function SearchableSelectOptionItem({
  option,
  index,
  id,
  isSelected,
  isHighlighted,
  onSelect,
  onMouseEnter,
  showRadio,
  descriptionMode = 'inline',
  action,
  variant = 'default',
}: {
  option: SearchableSelectOption;
  index: number;
  id: string;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: (value: string) => void;
  onMouseEnter: (index: number) => void;
  showRadio?: boolean;
  descriptionMode?: 'inline' | 'tooltip';
  action?: ReactNode;
  variant?: 'default' | 'switcher';
}) {
  const isSwitcher = variant === 'switcher';

  if (option.isSectionHeader) {
    return (
      <div
        id={id}
        data-index={index}
        role="presentation"
        className="text-muted-foreground flex items-center gap-1 px-2 pt-2 pb-1 text-xs font-medium tracking-wide uppercase"
      >
        {option.label}
        {option.labelBadge}
      </div>
    );
  }

  // Inline mode renders the description directly under the label; tooltip
  // mode hides it from the row and surfaces it on hover/keyboard-highlight.
  // The `items-start` vs `items-center` swap is only relevant for inline —
  // tooltip mode keeps a single-line row regardless of whether a description
  // exists.
  const showInlineDescription =
    descriptionMode === 'inline' && Boolean(option.description);
  const tooltipContent =
    descriptionMode === 'tooltip' && option.description
      ? option.description
      : null;

  const leadingCheck = isSwitcher && !showRadio;
  const trailingCheck = !isSwitcher && !showRadio && isSelected;

  const row = (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled via aria-activedescendant
    <div
      role="option"
      id={id}
      data-index={index}
      aria-selected={isSelected}
      aria-disabled={option.disabled || undefined}
      data-highlighted={isHighlighted || undefined}
      onClick={() => !option.disabled && onSelect(option.value)}
      onMouseEnter={() => onMouseEnter(index)}
      className={cn(
        'group/option relative flex w-full cursor-default gap-2 text-left text-sm transition-colors',
        isSwitcher
          ? 'border-border rounded-none border-b px-3 py-2 last:border-b-0'
          : 'rounded-md p-2',
        showInlineDescription ? 'items-start' : 'items-center',
        isSwitcher && isSelected && 'bg-muted/60',
        isHighlighted && !(isSwitcher && isSelected) && 'bg-accent',
        option.disabled && 'pointer-events-none opacity-50',
      )}
    >
      {isSwitcher && isSelected && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-0.5 bg-blue-600"
        />
      )}
      {showRadio && (
        // Outer wrapper matches the first label-row height (~24px, driven by
        // the optional badge's line-height + py) and centers the 16px radio
        // within it. Without this, `items-start` on the parent would top-align
        // the smaller radio against a taller label+badge row, leaving the
        // circle visibly above the badge's vertical center.
        <span
          aria-hidden="true"
          className="pointer-events-none flex h-6 shrink-0 items-center"
        >
          <span
            className={cn(
              'border-border bg-background flex size-4 items-center justify-center rounded-full border transition-colors duration-150',
              isSelected && 'border-blue-600',
            )}
          >
            {isSelected && (
              <Circle
                className="size-2.5 fill-blue-600 text-blue-600"
                aria-hidden="true"
              />
            )}
          </span>
        </span>
      )}
      {leadingCheck && (
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center"
        >
          {isSelected ? (
            <Check className="size-4 text-blue-600" />
          ) : (
            <span className="size-4" />
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text as="span" variant="label">
            {option.label}
          </Text>
          {option.labelBadge}
        </div>
        {showInlineDescription && (
          <Text
            as="div"
            variant="caption"
            className="line-clamp-2"
            title={option.description}
          >
            {option.description}
          </Text>
        )}
      </div>
      {trailingCheck && (
        <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
      )}
      {action}
    </div>
  );

  if (!tooltipContent) return row;

  // In tooltip mode the description is hidden from the row and surfaced on
  // hover (or keyboard highlight, which fires onMouseEnter via this row's
  // own pointer events as the listbox scrolls a focused option into view).
  // `side="right"` keeps the popover from overlapping the next row's label;
  // `align="start"` anchors it to the row top so long descriptions don't
  // float into the row above.
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{row}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipContent
            side="right"
            align="start"
            collisionPadding={8}
            className="max-w-xs text-xs leading-relaxed"
          >
            {tooltipContent}
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
