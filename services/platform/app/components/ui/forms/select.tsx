'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { cva } from 'class-variance-authority';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentPropsWithoutRef, ComponentRef, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils/cn';

import { FieldShell } from './field-shell';
import { Label } from './label';

const selectContentVariants = cva(
  // Cap the dropdown at the smaller of 24rem (the historical max) and the space
  // Radix measures between the trigger and the viewport edge. Without this the
  // content kept a fixed 24rem height and, near the bottom of a short viewport,
  // could extend past the edge and clip its first option (e.g. "End workflow")
  // behind the scroll buttons. The `,24rem` fallback keeps the cap for the
  // `item-aligned` position, where Radix does not expose the available-height var.
  'relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height,24rem))] min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground dark:bg-muted shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  {
    variants: {
      position: {
        popper:
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        'item-aligned': '',
      },
    },
    defaultVariants: {
      position: 'popper',
    },
  },
);

const selectViewportVariants = cva('p-1', {
  variants: {
    position: {
      popper:
        'h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)',
      'item-aligned': '',
    },
  },
  defaultVariants: {
    position: 'popper',
  },
});

export function selectTriggerClasses({
  error,
}: {
  error?: boolean;
} = {}) {
  return cn(
    // One height fits all controls (`h-9`) — no size axis.
    'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-lg border border-transparent bg-input px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 ring-1 ring-border focus-visible:ring-primary transition-[border-color,box-shadow] duration-150',
    error && 'border-destructive focus-visible:ring-destructive',
  );
}

interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SelectProps extends Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Root>,
  'children'
> {
  /** Array of options to display */
  options: SelectOption[];
  /** Label displayed above the select */
  label?: string;
  /** Placeholder text when no value is selected */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the field has an error */
  error?: boolean;
  /** Description text displayed below the select */
  description?: ReactNode;
  /** Additional class name for the trigger */
  className?: string;
  /** Additional class name for the outer label+trigger+description wrapper. */
  wrapperClassName?: string;
  /** ID for the trigger element */
  id?: string;
  /** Content position */
  position?: 'popper' | 'item-aligned';
  /** Side offset for popper position */
  sideOffset?: number;
  /** Accessible name forwarded to the combobox trigger button. */
  'aria-label'?: string;
  /** Id of an element labelling the combobox trigger button. */
  'aria-labelledby'?: string;
}

// Plain control — the real Radix combobox trigger + content (+ optional
// label/description). No skeleton logic of its own.
const SelectBase = forwardRef<
  ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectProps
>(
  (
    {
      options,
      label,
      placeholder,
      required,
      error,
      description,
      className,
      wrapperClassName,
      id: providedId,
      position = 'popper',
      sideOffset,
      disabled,
      value,
      defaultValue,
      onValueChange,
      // Pulled out of `...props` (which spreads onto the non-DOM Radix `Root`)
      // so they land on the actual combobox `Trigger` button — without this an
      // unlabelled inline Select has no accessible name (axe `button-name`).
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const descriptionId = `${id}-description`;
    const labelId = `${id}-label`;
    // A Radix trigger is a <button>, so a `<label htmlFor>` does NOT name it.
    // Point the trigger at the rendered label via aria-labelledby (unless the
    // caller supplied an explicit name), so labelled selects have a name.
    const resolvedLabelledBy = ariaLabelledBy ?? (label ? labelId : undefined);

    const trigger = (
      <SelectPrimitive.Root
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        {...props}
      >
        <SelectPrimitive.Trigger
          ref={ref}
          id={id}
          className={cn(selectTriggerClasses({ error }), className)}
          aria-invalid={error}
          aria-label={ariaLabel}
          aria-labelledby={resolvedLabelledBy}
          aria-describedby={description ? descriptionId : undefined}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-4 opacity-50" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className={selectContentVariants({ position })}
            position={position}
            sideOffset={sideOffset}
            // Keep a small gap from the viewport edge so the dropdown (and its
            // first option) is never flush against / clipped by the edge (#1492).
            collisionPadding={8}
          >
            <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
              <ChevronUp className="size-4" aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport
              className={selectViewportVariants({ position })}
            >
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50"
                >
                  <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4" aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>
                    {option.icon ? (
                      <span className="flex items-center gap-2">
                        {option.icon}
                        {option.label}
                      </span>
                    ) : (
                      option.label
                    )}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
              <ChevronDown className="size-4" aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );

    if (!label && !description) {
      return wrapperClassName ? (
        <div className={wrapperClassName}>{trigger}</div>
      ) : (
        trigger
      );
    }

    return (
      <FieldShell
        {...(label
          ? {
              label: (
                <Label
                  id={labelId}
                  htmlFor={id}
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
        {trigger}
      </FieldShell>
    );
  },
);
SelectBase.displayName = 'SelectBase';

/**
 * Skeleton-aware Select. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact trigger size, pulse overlay on top — so the skeleton can never
 * drift from the live control.
 */
export const Select = forwardRef<
  ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectProps
>((props, ref) => {
  const loading = useSkeleton();
  if (loading) {
    // `fullWidth` so the mask is block-level and stacks under sibling fields
    // (matches Input/CopyableField). A bare inline-block mask let stacked
    // controls flow side-by-side while loading, then snap to a column.
    return (
      <SkeletonBox fullWidth>
        <SelectBase {...props} ref={ref} />
      </SkeletonBox>
    );
  }
  return <SelectBase {...props} ref={ref} />;
});
Select.displayName = 'Select';
