'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const statusIndicatorVariants = cva('flex items-center space-x-2 text-sm', {
  variants: {
    variant: {
      success: 'text-success',
      warning: 'text-warning',
      error: 'text-destructive',
      info: 'text-info-foreground',
      neutral: 'text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'success',
  },
});

const statusDotVariants = cva('rounded-full', {
  variants: {
    variant: {
      success: 'bg-success',
      warning: 'bg-warning',
      error: 'bg-destructive',
      info: 'bg-info-foreground',
      neutral: 'bg-muted-foreground',
    },
    size: {
      sm: 'w-1.5 h-1.5',
      md: 'w-2 h-2',
      lg: 'w-2.5 h-2.5',
    },
  },
  defaultVariants: {
    variant: 'success',
    size: 'md',
  },
});

type _StatusVariant = NonNullable<
  VariantProps<typeof statusIndicatorVariants>['variant']
>;

interface StatusIndicatorProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusIndicatorVariants>,
    Pick<VariantProps<typeof statusDotVariants>, 'size'> {
  /** Whether to animate the indicator (pulse effect) */
  pulse?: boolean;
  /** Text to display next to the indicator */
  children?: React.ReactNode;
}

export const StatusIndicator = forwardRef<HTMLDivElement, StatusIndicatorProps>(
  ({ variant, pulse = false, size, children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(statusIndicatorVariants({ variant }), className)}
      {...props}
    >
      <div
        className={cn(
          statusDotVariants({ variant, size }),
          pulse && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      {children && <span>{children}</span>}
    </div>
  ),
);
StatusIndicator.displayName = 'StatusIndicator';
