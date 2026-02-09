'use client';

import * as React from 'react';

import { cn } from '@/lib/utils/cn';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  indicatorClassName?: string;
  /** Accessible label for screen readers */
  label?: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    { className, value = 0, max = 100, indicatorClassName, label, ...props },
    ref,
  ) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-muted',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full w-full flex-1 bg-primary transition-all duration-300 ease-in-out',
            indicatorClassName,
          )}
          style={{ transform: `translateX(-${100 - percentage}%)` }}
          aria-hidden="true"
        />
      </div>
    );
  },
);

Progress.displayName = 'Progress';
