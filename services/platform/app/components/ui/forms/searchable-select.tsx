"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, Search } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Text } from "@/app/components/ui/typography/text";
import { cn } from "@/lib/utils/cn";

export interface SearchableSelectOption {
  value: string;
  label: string;
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
  /** Custom trigger element */
  trigger: ReactNode;
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
  align?: "start" | "center" | "end";
  /** Popover side */
  side?: "top" | "right" | "bottom" | "left";
  /** Popover side offset in pixels */
  sideOffset?: number;
  /** Additional className for the popover content */
  contentClassName?: string;
  /** Accessible label for the listbox */
  "aria-label"?: string;
  /** Custom filter function; defaults to case-insensitive match on label + description */
  filterFn?: (option: SearchableSelectOption, query: string) => boolean;
}

const CONTENT_CLASSES =
  "z-50 min-w-[14.5rem] rounded-lg ring-1 ring-border bg-popover text-popover-foreground shadow-md outline-none p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

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
  searchPlaceholder,
  emptyText,
  footer,
  open: controlledOpen,
  onOpenChange,
  align = "center",
  side,
  sideOffset = 4,
  contentClassName,
  "aria-label": ariaLabel,
  filterFn,
}: SearchableSelectProps) {
  const instanceId = useId();
  const listboxId = `${instanceId}-listbox`;
  const optionId = (index: number) => `${instanceId}-option-${index}`;

  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const [search, setSearch] = useState("");
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
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, isOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen) {
        setSearch("");
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
        case "ArrowDown": {
          e.preventDefault();
          const next = findNextEnabledIndex(
            filteredOptions,
            highlightedIndex,
            1,
          );
          if (next >= 0) setHighlightedIndex(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = findNextEnabledIndex(
            filteredOptions,
            highlightedIndex,
            -1,
          );
          if (prev >= 0) setHighlightedIndex(prev);
          break;
        }
        case "Enter": {
          e.preventDefault();
          const option = filteredOptions[highlightedIndex];
          if (option && !option.disabled) {
            handleSelect(option.value);
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          const first = findNextEnabledIndex(filteredOptions, -1, 1);
          if (first >= 0) setHighlightedIndex(first);
          break;
        }
        case "End": {
          e.preventDefault();
          const last = findNextEnabledIndex(filteredOptions, len, -1);
          if (last >= 0) setHighlightedIndex(last);
          break;
        }
      }
    },
    [filteredOptions, highlightedIndex, handleSelect],
  );

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
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
          <div className="border-border flex items-center gap-2 border-b px-3 py-2">
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
}

function SearchableSelectOptionItem({
  option,
  index,
  id,
  isSelected,
  isHighlighted,
  onSelect,
  onMouseEnter,
}: {
  option: SearchableSelectOption;
  index: number;
  id: string;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: (value: string) => void;
  onMouseEnter: (index: number) => void;
}) {
  return (
    <div
      role="option"
      id={id}
      data-index={index}
      aria-selected={isSelected}
      aria-disabled={option.disabled || undefined}
      data-highlighted={isHighlighted || undefined}
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled on the combobox input via aria-activedescendant
      onClick={() => !option.disabled && onSelect(option.value)}
      onMouseEnter={() => onMouseEnter(index)}
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        isHighlighted && "bg-accent",
        option.disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <Text as="div" variant="label">
          {option.label}
        </Text>
        {option.description && (
          <Text as="div" variant="caption">
            {option.description}
          </Text>
        )}
      </div>
      {isSelected && (
        <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}
