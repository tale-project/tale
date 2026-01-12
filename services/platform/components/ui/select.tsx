'use client';

import { forwardRef, useId } from 'react';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils/cn';
import { Label } from './label';

const selectContentVariants = cva(
  'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
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
  }
);

const selectViewportVariants = cva('p-1', {
  variants: {
    position: {
      popper:
        'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
      'item-aligned': '',
    },
  },
  defaultVariants: {
    position: 'popper',
  },
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, 'children'> {
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
  /** Additional class name for the trigger */
  className?: string;
  /** ID for the trigger element */
  id?: string;
  /** Content position */
  position?: 'popper' | 'item-aligned';
  /** Side offset for popper position */
  sideOffset?: number;
}

export const Select = forwardRef<
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
      className,
      id: providedId,
      position = 'popper',
      sideOffset,
      disabled,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;

    const trigger = (
      <SelectPrimitive.Root disabled={disabled} {...props}>
        <SelectPrimitive.Trigger
          ref={ref}
          id={id}
          className={cn(
            'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
            error && 'border-destructive focus:ring-destructive',
            className
          )}
          aria-invalid={error}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-4 opacity-50" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className={selectContentVariants({ position })}
            position={position}
            sideOffset={sideOffset}
          >
            <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
              <ChevronUp className="size-4" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className={selectViewportVariants({ position })}>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
              <ChevronDown className="size-4" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );

    if (!label) {
      return trigger;
    }

    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} required={required} error={error}>
          {label}
        </Label>
        {trigger}
      </div>
    );
  },
);
Select.displayName = 'Select';

