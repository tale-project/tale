'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useId } from 'react';

import { cn } from '@/lib/utils/cn';

import { FieldShell } from './field-shell';
import { Label } from './label';

interface SegmentedControlOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  id?: string;
  label?: string;
  required?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedControlOption[];
  disabled?: boolean;
  className?: string;
}

/**
 * A segmented button group for choosing between a small set of mutually
 * exclusive options — the compact alternative to radio buttons when there
 * are only 2–4 options and descriptions are not needed.
 *
 * Selection is never cleared: if the user clicks the active option, nothing
 * changes (preventing an empty state).
 */
export function SegmentedControl({
  id: providedId,
  label,
  required,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: SegmentedControlProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  const handleValueChange = (next: string) => {
    // Radix calls this with '' when the user re-clicks the active item.
    // We treat the control as always-selected, so ignore empty.
    if (next) onValueChange(next);
  };

  return (
    <FieldShell
      {...(label
        ? {
            label: (
              <Label id={`${id}-label`} required={required}>
                {label}
              </Label>
            ),
          }
        : {})}
    >
      <ToggleGroupPrimitive.Root
        type="single"
        value={value}
        onValueChange={handleValueChange}
        disabled={disabled}
        aria-labelledby={label ? `${id}-label` : undefined}
        className={cn(
          'inline-flex rounded-md border border-border bg-muted p-0.5 gap-0.5',
          className,
        )}
      >
        {options.map((option) => (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className={cn(
              'flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer',
              'text-muted-foreground',
              'data-[state=on]:bg-white dark:data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {option.label}
          </ToggleGroupPrimitive.Item>
        ))}
      </ToggleGroupPrimitive.Root>
    </FieldShell>
  );
}
