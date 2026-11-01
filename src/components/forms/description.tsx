'use client';

import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '../../lib/cn';

interface DescriptionProps extends HTMLAttributes<HTMLDivElement> {
  /** Display muted/secondary styling (default: true) */
  muted?: boolean;
}

// A `<div>`, not a `<p>`: description content is arbitrary (links, and
// skeleton-masked block leaves like `<Skeletonize>`'s `role="status"` div), and
// a `<p>` cannot legally contain block elements — that nesting throws a
// hydration error. The text is associated with its control via
// `aria-describedby`, so paragraph semantics aren't required.
export const Description = forwardRef<HTMLDivElement, DescriptionProps>(
  ({ className, muted = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'text-xs leading-relaxed',
        muted && 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Description.displayName = 'Description';
