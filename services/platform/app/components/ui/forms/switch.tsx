'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import type { ComponentRef, ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils/cn';

import { Label } from './label';

interface SwitchProps extends ComponentPropsWithoutRef<
  typeof SwitchPrimitive.Root
> {
  label?: string;
  description?: ReactNode;
  /**
   * Visually hide the label on small screens (it stays available to screen
   * readers via `sr-only`). Use when the switch sits in a section header whose
   * title already names the control — a long localized label (e.g. German
   * "Anmeldeversuch-Limits aktivieren") would otherwise overflow the narrow
   * header row on mobile.
   */
  hideLabelOnMobile?: boolean;
}

/**
 * Single source of the switch track dimensions. Shared by the live Radix
 * control — replaces the ~10 hand-copied `h-[1.15rem] w-8` skeletons across
 * governance editors.
 */
export const SWITCH_TRACK_DIMENSIONS = 'h-[1.15rem] w-8';

// Plain control — the real Radix switch (+ optional label/description). No
// skeleton logic of its own.
const SwitchBase = forwardRef<
  ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(
  (
    {
      className,
      label,
      description,
      hideLabelOnMobile,
      required,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const descriptionId = `${id}-description`;
    const labelClassName = cn(
      'cursor-pointer',
      hideLabelOnMobile && 'sr-only sm:not-sr-only',
    );

    const switchElement = (
      <SwitchPrimitive.Root
        ref={ref}
        id={id}
        data-slot="switch"
        className={cn(
          // Light mode: the unchecked track (`bg-border`, 90% L) is barely
          // perceptible on the near-white page (~1.2:1) — and `disabled` halves
          // it again into invisibility. Give the unchecked track a visible
          // `border-border-strong` outline so the control's shape always reads,
          // even when disabled. Dark mode already has enough edge contrast (see
          // globals.css), so it keeps the transparent border there.
          'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-border data-[state=unchecked]:border-border-strong focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-border/80 inline-flex shrink-0 items-center rounded-full border shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-transparent dark:border-transparent',
          SWITCH_TRACK_DIMENSIONS,
          className,
        )}
        required={required}
        aria-describedby={description ? descriptionId : undefined}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
          )}
        />
      </SwitchPrimitive.Root>
    );

    if (!label && !description) {
      return switchElement;
    }

    if (description) {
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            {label && (
              <Label
                htmlFor={id}
                required={required}
                className={labelClassName}
              >
                {label}
              </Label>
            )}
            {switchElement}
          </div>
          <Description id={descriptionId}>{description}</Description>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} required={required} className={labelClassName}>
          {label}
        </Label>
        {switchElement}
      </div>
    );
  },
);
SwitchBase.displayName = 'SwitchBase';

/**
 * Skeleton-aware Switch. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact size, pulse overlay on top — so the skeleton can never drift.
 */
export const Switch = forwardRef<
  ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>((props, ref) => {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <SwitchBase {...props} ref={ref} />
      </SkeletonBox>
    );
  }
  return <SwitchBase {...props} ref={ref} />;
});
Switch.displayName = SwitchPrimitive.Root.displayName;
