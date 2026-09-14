import { cn } from '@tale/ui/cn';
import type { HTMLAttributes } from 'react';

/**
 * Marketing-page content width: design uses 1280px frame with 80px L/R
 * padding, yielding a 1120px content area. Mobile uses 24px to match
 * Pencil section padding.
 */
export function SiteContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1280px] px-6 md:px-20', className)}
      {...props}
    />
  );
}
