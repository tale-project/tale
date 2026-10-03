import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from './skeleton';

// A badge is a label, never a control: no hover fill or focus ring that would
// promise a click nothing answers. Each tint carries its own dark pair — a
// translucent wash of the hue under a light tone of it — because the light
// pastels (`bg-*-100`) glare as bright pills on the near-black dark surface.
export const badgeVariants = cva(
  'inline-flex items-center overflow-hidden rounded-md border-transparent px-2.5 py-1 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        outline: 'border-border bg-background text-foreground border',
        destructive:
          'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
        orange:
          'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
        yellow:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200',
        blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
        green:
          'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
        slate:
          'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-neutral-300',
      },
    },
    defaultVariants: {
      variant: 'outline',
    },
  },
);

const dotVariants = cva('m-1 size-1.5 rounded-full', {
  variants: {
    variant: {
      outline: 'bg-gray-600 dark:bg-neutral-400',
      destructive: 'bg-red-600 dark:bg-red-400',
      orange: 'bg-orange-600 dark:bg-orange-400',
      yellow: 'bg-yellow-600 dark:bg-yellow-400',
      blue: 'bg-blue-600 dark:bg-blue-400',
      green: 'bg-green-600 dark:bg-green-400',
      slate: 'bg-slate-600 dark:bg-neutral-400',
    },
  },
  defaultVariants: {
    variant: 'outline',
  },
});

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  icon?: React.ComponentType<{ className?: string }>;
  dot?: boolean;
  children: React.ReactNode;
}

/** Masks the real badge surface while loading, preserving its exact footprint. */
export function Badge({
  className,
  variant,
  icon: Icon,
  children,
  dot,
  ...props
}: BadgeProps) {
  return (
    <SkeletonBox asChild>
      <div
        title={typeof children === 'string' ? children : undefined}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      >
        {dot && (
          <div className="mr-1 shrink-0" aria-hidden="true">
            <div className={cn(dotVariants({ variant }))} />
          </div>
        )}
        {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
        <span className={cn(Icon && 'ml-1', 'truncate leading-4')}>
          {children}
        </span>
      </div>
    </SkeletonBox>
  );
}
