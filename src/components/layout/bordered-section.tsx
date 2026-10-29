'use client';

import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

export const BorderedSection = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'border-border flex flex-col gap-3 rounded-lg border p-4',
      className,
    )}
    {...props}
  />
));
BorderedSection.displayName = 'BorderedSection';
