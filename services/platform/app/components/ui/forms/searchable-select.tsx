'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
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

import { Text } from '@/app/components/ui/typography/text';
import { cn } from '@/lib/utils/cn';

import { Description } from './description';
import { Label } from './label';
import { selectTriggerClasses, type SelectTriggerSize } from './select';

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
  /** Size of the default trigger — matches the `Select` component's sizes. */
  size?: SelectTriggerSize;
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
}

const CONTENT_CLASSES =
  'z-50 min-w-[14.5rem] rounded-lg ring-1 ring-border bg-muted text-popover-foreground shadow-md outline-none p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2';

function defaultFilterFn(option: SearchableSelectOption, query: string) {
  const lower = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(lower) ||
    (option.description?.toLowerCase().includes(lower) ?? false)
  );
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
  while (options[index]?.disabled && iterations < len) {
    index = (index + direction + len) % len;
    iterations++;
  }
  return options[index]?.disabled ? -1 : index;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  trigger,
  label,
  placeholder,
  size = 'default',
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
}: SearchableSelectProps) {
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
      className={cn(selectTriggerClasses({ size, error }), triggerClassName)}
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

  const initializeHighlight = useCallback(() => {
    if (filteredOptions.length === 0) return;
    if (value) {
      const idx = filteredOptions.findIndex((o) => o.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(0);
    }
  }, [value, filteredOptions]);

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
      setIsOpen(nextOpen);
      if (!nextOpen) {
        setSearch('');
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
          if (option && !option.disabled) {
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

  const popover = (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        {defaultTrigger}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={cn(CONTENT_CLASSES, contentClassName)}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
            initializeHighlight();
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
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

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-[20rem] overflow-y-auto p-1"
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
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label htmlFor={triggerId} required={required} error={error}>
          {label}
        </Label>
      )}
      {popover}
      {description && (
        <Description id={descriptionId} className="text-xs">
          {description}
        </Description>
      )}
    </div>
  );
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
  action,
}: {
  option: SearchableSelectOption;
  index: number;
  id: string;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: (value: string) => void;
  onMouseEnter: (index: number) => void;
  showRadio?: boolean;
  action?: ReactNode;
}) {
  return (
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
        'group/option flex w-full cursor-default gap-2 rounded-md p-2 text-left text-sm transition-colors',
        option.description ? 'items-start' : 'items-center',
        isHighlighted && 'bg-accent',
        option.disabled && 'pointer-events-none opacity-50',
      )}
    >
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
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text as="span" variant="label">
            {option.label}
          </Text>
          {option.labelBadge}
        </div>
        {option.description && (
          <Text as="div" variant="caption">
            {option.description}
          </Text>
        )}
      </div>
      {!showRadio && isSelected && (
        <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
      )}
      {action}
    </div>
  );
}
