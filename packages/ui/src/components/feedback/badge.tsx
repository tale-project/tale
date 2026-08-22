import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from './skeleton';

export const badgeVariants = cva(
  'focus:ring-ring text-primary-muted hover:bg-primary-foreground/10 text-secondary inline-flex items-center overflow-hidden rounded-md border-transparent px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
  {
    variants: {
      variant: {
        outline: 'border-border bg-background text-foreground border',
        destructive: 'bg-red-100 text-red-800 hover:bg-red-100/80',
        orange: 'bg-orange-100 text-orange-800 hover:bg-orange-100/80',
        yellow: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80',
        blue: 'bg-blue-100 text-blue-800 hover:bg-blue-100/80',
        green: 'bg-green-100 text-green-800 hover:bg-green-100/80',
        slate: 'bg-slate-100 text-slate-700 hover:bg-slate-100/80',
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
      outline: 'bg-gray-600',
      destructive: 'bg-red-600',
      orange: 'bg-orange-600',
      yellow: 'bg-yellow-600',
      blue: 'bg-blue-600',
      green: 'bg-green-600',
      slate: 'bg-slate-600',
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

/**
 * Skeleton-aware Badge. Always wraps the real badge in a `<SkeletonBox>`: idle,
 * the box is `display: contents`; inside a `<Skeletonize loading>` it masks the
 * badge with an overlay at its exact footprint.
 */
export function Badge({
  className,
  variant,
  icon: Icon,
  children,
  dot,
  ...props
}: BadgeProps) {
  return (
    <SkeletonBox>
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
