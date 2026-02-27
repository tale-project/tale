'use client';

import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

export const BorderedSection = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex flex-col gap-3 rounded-lg border border-border p-4',
      className,
    )}
    {...props}
  />
));
BorderedSection.displayName = 'BorderedSection';
