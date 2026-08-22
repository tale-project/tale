'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Circle } from 'lucide-react';
import type { ComponentRef, ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils/cn';

import { FieldShell } from './field-shell';
import { Label } from './label';

export interface RadioGroupOption {
  value: string;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

interface RadioGroupProps extends ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Root
> {
  label?: string;
  description?: ReactNode;
  /** Additional className for the outer label+options+description frame. */
  wrapperClassName?: string;
  options?: RadioGroupOption[];
  /**
   * Number of columns for the options grid.
   * @default 1
   */
  columns?: 1 | 2;
}

export const RadioGroup = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(
  (
    {
      className,
      label,
      description,
      wrapperClassName,
      required,
      id: providedId,
      options,
      columns = 1,
      children,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const descriptionId = `${id}-description`;

    return (
      <FieldShell
        // An option list reads as rows of its own, so it keeps the full width
        // of the control column even in label-left layouts.
        wideControl
        {...(label
          ? {
              label: (
                <Label id={`${id}-label`} required={required}>
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
        <RadioGroupPrimitive.Root
          className={cn(
            'grid gap-2',
            columns === 2 && 'grid-cols-2',
            className,
          )}
          {...props}
          ref={ref}
          required={required}
          aria-labelledby={label ? `${id}-label` : ariaLabelledBy}
          aria-describedby={description ? descriptionId : ariaDescribedBy}
        >
          {options
            ? options.map((option) => (
                <RadioGroupItem
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  description={option.description}
                  disabled={option.disabled}
                />
              ))
            : children}
        </RadioGroupPrimitive.Root>
      </FieldShell>
    );
  },
);
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

interface RadioGroupItemProps extends ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Item
> {
  label?: string;
  description?: ReactNode;
}

// Plain control — the real radio (+ optional label/description). No skeleton
// logic of its own.
const RadioGroupItemBase = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, label, description, id: providedId, ...props }, ref) => {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  const radio = (
    <RadioGroupPrimitive.Item
      ref={ref}
      id={id}
      className={cn(
        'border-primary ring-offset-background focus-visible:ring-ring aspect-square size-4 shrink-0 rounded-full border text-(--color-accent-base) transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-(--color-accent-base)',
        description && 'mt-0.5',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle
          className="h-2.5 w-2.5 fill-current text-current"
          aria-hidden="true"
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );

  if (!label) {
    return radio;
  }

  return (
    <label
      className={cn(
        'flex gap-2',
        description ? 'items-start' : 'items-center',
        props.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      {radio}
      {description ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs leading-none font-normal md:text-sm">
            {label}
          </span>
          <Description>{description}</Description>
        </div>
      ) : (
        <span className="text-xs leading-none font-normal md:text-sm">
          {label}
        </span>
      )}
    </label>
  );
});
RadioGroupItemBase.displayName = 'RadioGroupItemBase';

/**
 * Skeleton-aware RadioGroupItem. Inside a `<Skeletonize loading>` it masks the
 * plain control by rendering it inside a `<SkeletonBox>` — laid out invisibly
 * to set the exact size, pulse overlay on top — so the skeleton can never
 * drift.
 */
export const RadioGroupItem = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>((props, ref) => {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <RadioGroupItemBase {...props} ref={ref} />
      </SkeletonBox>
    );
  }
  return <RadioGroupItemBase {...props} ref={ref} />;
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;
