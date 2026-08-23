'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils/cn';

import { Label } from './label';

interface CheckboxProps extends React.ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
> {
  label?: string;
  description?: React.ReactNode;
  required?: boolean;
}

// Plain control — the real checkbox (+ optional label/description). No skeleton
// logic of its own.
const CheckboxBase = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(
  (
    {
      className,
      onCheckedChange,
      checked,
      label,
      description,
      required,
      id: providedId,
      'aria-describedby': callerAriaDescribedBy,
      ...rest
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const id = providedId ?? generatedId;
    const descriptionId = `${id}-description`;

    const checkbox = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={id}
        className={cn(
          'peer border-border ring-offset-background focus-visible:ring-ring bg-background size-4 shrink-0 rounded-sm border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[state=checked]:border-(--color-accent-base) data-[state=checked]:bg-(--color-accent-base) data-[state=checked]:text-(--color-accent-fg) data-[state=indeterminate]:border-(--color-accent-base) data-[state=indeterminate]:bg-(--color-accent-base) data-[state=indeterminate]:text-(--color-accent-fg)',
          className,
        )}
        onCheckedChange={onCheckedChange}
        {...rest}
        checked={checked}
        required={required}
        aria-describedby={description ? descriptionId : callerAriaDescribedBy}
      >
        <CheckboxPrimitive.Indicator
          className={cn(
            'flex items-center justify-center pt-[0.025rem] text-current',
          )}
        >
          {checked === 'indeterminate' ? (
            <Minus
              className="size-[0.875rem]"
              strokeWidth={3}
              aria-hidden="true"
            />
          ) : (
            <Check
              className="size-[0.875rem]"
              strokeWidth={3}
              aria-hidden="true"
            />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (!label && !description) {
      return checkbox;
    }

    if (description) {
      return (
        <div className="flex items-start gap-2">
          <div className="mt-0.5">{checkbox}</div>
          <div className="flex flex-col gap-1">
            {label && (
              <Label
                htmlFor={id}
                required={required}
                className="cursor-pointer"
              >
                {label}
              </Label>
            )}
            <Description id={descriptionId}>{description}</Description>
          </div>
        </div>
      );
    }

    // `items-start` keeps the box pinned to the FIRST line of the label (not
    // centered over the whole block) when the text wraps. `leading-5` makes that
    // first line a 1.25rem box and `mt-0.5` nudges the 1rem checkbox to sit
    // centered within it, so single-line rows still read as vertically centered.
    // The checkbox stays a direct previous sibling of the label (offset via the
    // `[&>button]` variant, not a wrapper) so the label's `peer-disabled:` styles
    // keep working.
    return (
      <div className="flex items-start gap-2 [&>button]:mt-0.5">
        {checkbox}
        <Label
          htmlFor={id}
          required={required}
          className="cursor-pointer leading-5"
        >
          {label}
        </Label>
      </div>
    );
  },
);
CheckboxBase.displayName = 'CheckboxBase';

/**
 * Skeleton-aware Checkbox. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact size, pulse overlay on top — so the skeleton can never drift.
 */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>((props, ref) => {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <CheckboxBase {...props} ref={ref} />
      </SkeletonBox>
    );
  }
  return <CheckboxBase {...props} ref={ref} />;
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
