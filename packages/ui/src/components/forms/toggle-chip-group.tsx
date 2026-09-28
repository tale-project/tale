'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@tale/ui/cn';

export interface ToggleChipOption {
  value: string;
  /** The chip's visible text — short, often two letters ("Mo"). */
  label: string;
  /**
   * The chip's accessible name when the visible text is an abbreviation
   * ("Monday" for "Mo"). It must contain the visible text.
   */
  'aria-label'?: string;
}

export interface ToggleChipGroupProps {
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  options: readonly ToggleChipOption[];
  /**
   * The fewest chips that may be on. Turning off a chip that would go below
   * it is ignored — the chip stays pressed. Turning a chip on always counts,
   * even while the value starts below the minimum, so an empty start can
   * climb to it. @default 0
   */
  minSelected?: number;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

/**
 * A row of small toggle buttons for picking several of a few short options —
 * the days of the week in a repeat rule. One tab stop; the arrow keys move
 * between chips and Space or Enter toggles one. A pressed chip takes the
 * accent fill, so its state never rests on colour alone.
 */
export function ToggleChipGroup({
  value,
  onValueChange,
  options,
  minSelected = 0,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  className,
}: ToggleChipGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="multiple"
      // Radix calls a multiple toggle group a toolbar; it is a group of
      // related toggles, and a toolbar would ask for other controls in it.
      role="group"
      orientation="horizontal"
      loop
      value={[...value]}
      onValueChange={(next) => {
        // Only a chip turning off can break the minimum; one turning on
        // brings the value closer to it.
        if (next.length < value.length && next.length < minSelected) return;
        onValueChange(next);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={cn('flex flex-wrap gap-1', className)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          aria-label={option['aria-label']}
          className={cn(
            'inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium transition-colors duration-150',
            'ring-border text-muted-foreground hover:bg-accent hover:text-foreground ring-1 ring-inset',
            'data-[state=on]:bg-(--color-accent-base) data-[state=on]:text-(--color-accent-fg) data-[state=on]:ring-(--color-accent-base) data-[state=on]:hover:bg-(--color-accent-base)',
            // An outline, not a ring: the ring is the chip's own edge, and
            // on a pressed chip it is the fill's colour.
            'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
