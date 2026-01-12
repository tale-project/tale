'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const statusIndicatorVariants = cva('flex items-center space-x-2 text-sm', {
  variants: {
    variant: {
      success: 'text-green-600',
      warning: 'text-amber-600',
      error: 'text-red-600',
      info: 'text-blue-600',
      neutral: 'text-gray-600',
    },
  },
  defaultVariants: {
    variant: 'success',
  },
});

const statusDotVariants = cva('rounded-full', {
  variants: {
    variant: {
      success: 'bg-green-500',
      warning: 'bg-amber-500',
      error: 'bg-red-500',
      info: 'bg-blue-500',
      neutral: 'bg-gray-400',
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

type StatusVariant = NonNullable<
  VariantProps<typeof statusIndicatorVariants>['variant']
>;

interface StatusIndicatorProps
  extends HTMLAttributes<HTMLDivElement>,
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
          pulse && 'animate-pulse'
        )}
        aria-hidden="true"
      />
      {children && <span>{children}</span>}
    </div>
  )
);
StatusIndicator.displayName = 'StatusIndicator';

export type { StatusVariant };
