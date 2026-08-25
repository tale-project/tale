'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ChevronDown, Search, X } from 'lucide-react';
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

import { CappedScrollRegion } from '@/app/components/ui/data-display/capped-scroll-region';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Checkbox } from './checkbox';
import { FieldShell } from './field-shell';
import { Label } from './label';
import { selectTriggerClasses } from './select';

export interface MultiSelectOption {
  value: string;
  label: string;
  /**
   * Optional inline badge rendered right after the label (e.g. a category tag
   * on a tool row). Wraps onto a second line when the label is long.
   */
  labelBadge?: ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  /** The currently selected values. */
  value: ReadonlyArray<string>;
  /** Called with the COMPLETE next selection whenever an option is toggled. */
  onValueChange: (value: string[]) => void;
  /** Array of options to display. */
  options: ReadonlyArray<MultiSelectOption>;
  /**
   * Custom trigger element. If omitted, a default chip-rendering combobox
   * trigger is rendered using `label`, `placeholder`, `error`, etc.
   */
  trigger?: ReactNode;
  /** Label rendered above the default trigger. Ignored when `trigger` is provided. */
  label?: ReactNode;
  /**
   * Content shown on the default trigger when nothing is selected. A plain
   * string renders as muted placeholder text; pass a node (e.g. a chip) to
   * represent an implicit default such as "Organization-wide".
   */
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
  /** Additional className for the outer label+trigger+description frame. */
  wrapperClassName?: string;
  /**
   * Show the search input. Defaults to `true`; the popover is always
   * scrollable so large lists (~1000) stay usable via search + scroll.
   */
  searchable?: boolean;
  /** Placeholder text for the search input. */
  searchPlaceholder?: string;
  /** Text to display when no options match the search. */
  emptyText?: string;
  /** Optional footer content (e.g., an action button) rendered below the list. */
  footer?: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Called when open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Popover alignment relative to trigger. @default 'start' */
  align?: 'start' | 'center' | 'end';
  /** Popover side. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Popover side offset in pixels. @default 4 */
  sideOffset?: number;
  /** Additional className for the popover content. */
  contentClassName?: string;
  /** Accessible label for the listbox. */
  'aria-label'?: string;
  /** Custom filter function; defaults to case-insensitive match on label + description. */
  filterFn?: (option: MultiSelectOption, query: string) => boolean;
  /**
   * Builds the accessible label for a selected chip's remove button, e.g.
   * `(option) => t('removeX', { name: option.label })`. Falls back to the
   * option label alone when omitted.
   */
  removeChipLabel?: (option: MultiSelectOption) => string;
  /**
   * Optional action element rendered on the right side of each option row
   * (mirrors `SearchableSelect`'s `optionAction`). The element must stop
   * click propagation itself so activating it doesn't toggle the option.
   */
  optionAction?: (option: MultiSelectOption) => ReactNode;
  /**
   * Render the popover as a Radix modal layer. Required when the select sits
   * inside a modal Dialog: the dialog's scroll lock swallows wheel events over
   * the (portaled) popover, so a long option list won't wheel-scroll. A modal
   * popover registers its own scroll-lock shard, restoring scrolling.
   * @default false
   */
  modal?: boolean;
  /**
   * Cap the selected-chip area at this Tailwind max-height class (e.g.
   * `max-h-40`). When set, overflow shows a bottom gradient and a scroll-down
   * control instead of growing the trigger without bound.
   */
  chipsMaxHeightClassName?: string;
}

const CONTENT_CLASSES =
  'z-50 min-w-[14.5rem] rounded-lg ring-1 ring-border bg-popover text-popover-foreground dark:bg-muted shadow-md outline-none p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2';

function defaultFilterFn(option: MultiSelectOption, query: string) {
  const lower = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(lower) ||
    (option.description?.toLowerCase().includes(lower) ?? false)
  );
}

function findNextEnabledIndex(
  options: ReadonlyArray<MultiSelectOption>,
  current: number,
  direction: 1 | -1,
) {
  const len = options.length;
  if (len === 0) return -1;
  let index = (current + direction + len) % len;
  let iterations = 0;
  while (options[index]?.disabled && iterations < len) {
    index = (index + direction + len) % len;
    iterations++;
  }
  return options[index]?.disabled ? -1 : index;
}

// Plain control — the real default trigger (or caller-supplied `trigger`) +
// searchable popover (+ optional label/description). No skeleton logic.
function MultiSelectBase({
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
  wrapperClassName,
  searchable = true,
  searchPlaceholder,
  emptyText,
  footer,
  open: controlledOpen,
  onOpenChange,
  align = 'start',
  side,
  sideOffset = 4,
  contentClassName,
  'aria-label': ariaLabel,
  filterFn,
  removeChipLabel,
  optionAction,
  modal = false,
  chipsMaxHeightClassName,
}: MultiSelectProps) {
  const { t: tCommon } = useT('common');
  const instanceId = useId();
  const listboxId = `${instanceId}-listbox`;
  const optionId = (index: number) => `${instanceId}-option-${index}`;
  const triggerId = providedId ?? `${instanceId}-trigger`;
  const descriptionId = `${instanceId}-description`;
  const labelId = `${instanceId}-label`;

  const valueSet = useMemo(() => new Set(value), [value]);

  // Preserve selection order so chips read in the order the user picked them.
  const selectedOptions = useMemo(
    () =>
      value
        .map((v) => options.find((o) => o.value === v))
        .filter((o): o is MultiSelectOption => o !== undefined),
    [value, options],
  );

  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    return options.filter((o) => filter(o, search));
  }, [options, search, filter]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      // A disabled trigger must not open by any path (Radix's Trigger fires
      // onOpenToggle on mouse click regardless of our div's aria-disabled).
      if (disabled && nextOpen) return;
      setIsOpen(nextOpen);
      if (nextOpen) setHighlightedIndex(0);
      if (!nextOpen) setSearch('');
    },
    [disabled, setIsOpen],
  );

  // Toggle keeps the popover open — multi-select picks several values per visit.
  const handleToggle = useCallback(
    (optionValue: string) => {
      if (disabled) return;
      if (valueSet.has(optionValue)) {
        onValueChange(value.filter((v) => v !== optionValue));
      } else {
        onValueChange([...value, optionValue]);
      }
    },
    [disabled, value, valueSet, onValueChange],
  );

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
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
          if (option && !option.disabled) handleToggle(option.value);
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
    [filteredOptions, highlightedIndex, handleToggle],
  );

  const chips =
    selectedOptions.length === 0 ? (
      typeof placeholder === 'string' ? (
        <span className="text-muted-foreground min-w-0 truncate">
          {placeholder}
        </span>
      ) : (
        placeholder
      )
    ) : (
      selectedOptions.map((option) => (
        <span
          key={option.value}
          className="bg-muted inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
        >
          {option.label}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggle(option.value);
              }}
              className="text-muted-foreground hover:text-foreground -mr-0.5 rounded-sm"
              aria-label={
                removeChipLabel
                  ? removeChipLabel(option)
                  : `Remove ${option.label}`
              }
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </span>
      ))
    );

  // The chip remove buttons are nested inside the trigger, so the trigger must
  // be a <div> (not a <button>) to keep the markup valid. As a non-native
  // control it needs its own keyboard activation for Enter/Space.
  const defaultTrigger = trigger ?? (
    <div
      role="combobox"
      id={triggerId}
      tabIndex={disabled ? -1 : 0}
      aria-expanded={isOpen}
      aria-controls={isOpen ? listboxId : undefined}
      aria-disabled={disabled || undefined}
      aria-invalid={error || undefined}
      // A `<label htmlFor>` cannot name a role="combobox" div, so name the
      // trigger explicitly: prefer the visible label, fall back to aria-label.
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpenChange(!isOpen);
        }
      }}
      className={cn(
        selectTriggerClasses({ error }),
        'cursor-pointer gap-1.5',
        // Empty matches a closed Select (one row, chevron on the right).
        // Chips need to wrap, so only then grow past h-9.
        selectedOptions.length === 0
          ? 'overflow-hidden'
          : cn(
              'h-auto min-h-9 py-1.5 whitespace-normal',
              chipsMaxHeightClassName !== undefined
                ? 'items-start'
                : 'items-center',
            ),
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
        triggerClassName,
      )}
    >
      {chipsMaxHeightClassName !== undefined && selectedOptions.length > 0 ? (
        <CappedScrollRegion
          className="min-w-0 flex-1"
          maxHeightClassName={chipsMaxHeightClassName}
          fadeFromClassName="from-input"
          scrollLabel={tCommon('aria.scrollDown')}
        >
          <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
        </CappedScrollRegion>
      ) : (
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5',
            selectedOptions.length > 0 && 'flex-wrap',
          )}
        >
          {chips}
        </div>
      )}
      <ChevronDown
        className={cn(
          'size-4 shrink-0 opacity-50',
          chipsMaxHeightClassName !== undefined &&
            selectedOptions.length > 0 &&
            'mt-0.5 self-start',
        )}
        aria-hidden="true"
      />
    </div>
  );

  const popover = (
    <PopoverPrimitive.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      modal={modal}
    >
      <PopoverPrimitive.Trigger asChild>
        {defaultTrigger}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={cn(
            CONTENT_CLASSES,
            'w-(--radix-popover-trigger-width)',
            contentClassName,
          )}
          onOpenAutoFocus={(e) => {
            // Keep focus on the search input (or the list, when not searchable)
            // rather than the first option, so type-to-filter works immediately
            // and Arrow/Home/End/Enter drive the highlight in both modes.
            e.preventDefault();
            if (searchable) {
              searchRef.current?.focus();
            } else {
              listRef.current?.focus();
            }
          }}
        >
          {searchable && (
            <div className="border-border flex items-center gap-2 border-b p-3">
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
                onKeyDown={handleListKeyDown}
                placeholder={searchPlaceholder}
                className="placeholder:text-muted-foreground flex-1 bg-transparent text-base outline-none"
                aria-expanded={isOpen}
                aria-controls={listboxId}
                aria-activedescendant={
                  highlightedIndex < filteredOptions.length
                    ? optionId(highlightedIndex)
                    : undefined
                }
                aria-autocomplete="list"
                aria-label={searchPlaceholder}
              />
            </div>
          )}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel}
            // With no search input the listbox itself is the focusable, keyboard
            // -operable control, so it carries tabIndex + the roving descendant.
            tabIndex={searchable ? undefined : 0}
            onKeyDown={searchable ? undefined : handleListKeyDown}
            aria-activedescendant={
              !searchable && highlightedIndex < filteredOptions.length
                ? optionId(highlightedIndex)
                : undefined
            }
            className="max-h-[18rem] overflow-y-auto p-1 outline-none"
          >
            {filteredOptions.map((option, index) => (
              <MultiSelectOptionItem
                key={option.value}
                option={option}
                index={index}
                id={optionId(index)}
                isSelected={valueSet.has(option.value)}
                isHighlighted={highlightedIndex === index}
                onToggle={handleToggle}
                onMouseEnter={setHighlightedIndex}
                action={optionAction?.(option)}
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
    <FieldShell
      {...(label
        ? {
            label: (
              <Label
                id={labelId}
                htmlFor={triggerId}
                required={required}
                error={error}
              >
                {label}
              </Label>
            ),
          }
        : {})}
      {...(description
        ? {
            description: (
              <Description id={descriptionId}>{description}</Description>
            ),
          }
        : {})}
      {...(wrapperClassName !== undefined
        ? { className: wrapperClassName }
        : {})}
    >
      {popover}
    </FieldShell>
  );
}

/**
 * Skeleton-aware MultiSelect. Inside a `<Skeletonize loading>` it masks the
 * plain control by rendering it inside a `<SkeletonBox>` — laid out invisibly
 * to set the exact size, pulse overlay on top — so the skeleton can never
 * drift. Only the DEFAULT trigger is masked: when a custom `trigger` is
 * supplied the caller owns its own skeleton, so it renders normally.
 */
export function MultiSelect(props: MultiSelectProps) {
  const loading = useSkeleton();
  if (loading && !props.trigger) {
    return (
      <SkeletonBox>
        <MultiSelectBase {...props} />
      </SkeletonBox>
    );
  }
  return <MultiSelectBase {...props} />;
}

function MultiSelectOptionItem({
  option,
  index,
  id,
  isSelected,
  isHighlighted,
  onToggle,
  onMouseEnter,
  action,
}: {
  option: MultiSelectOption;
  index: number;
  id: string;
  isSelected: boolean;
  isHighlighted: boolean;
  onToggle: (value: string) => void;
  onMouseEnter: (index: number) => void;
  action?: ReactNode;
}) {
  const showDescription = Boolean(option.description);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled by the focused search input / listbox via aria-activedescendant
    <div
      role="option"
      id={id}
      data-index={index}
      aria-selected={isSelected}
      aria-disabled={option.disabled || undefined}
      data-highlighted={isHighlighted || undefined}
      onClick={() => !option.disabled && onToggle(option.value)}
      onMouseEnter={() => onMouseEnter(index)}
      className={cn(
        'group/option flex w-full cursor-default gap-2 rounded-md p-2 text-left text-sm transition-colors',
        showDescription ? 'items-start' : 'items-center',
        isHighlighted && 'bg-accent',
        option.disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none flex h-5 shrink-0 items-center"
      >
        <Checkbox checked={isSelected} tabIndex={-1} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text as="span" variant="label">
            {option.label}
          </Text>
          {option.labelBadge}
        </div>
        {showDescription && (
          // Clamped to two lines so a long catalog description can't blow out
          // the popover row; `title` keeps the full text one hover away
          // (screen readers still get the untruncated text — `line-clamp`
          // only affects paint, not the accessibility tree).
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
      {action}
    </div>
  );
}
