import { cn } from '@tale/ui/cn';
import type { HTMLAttributes } from 'react';

/**
 * Marketing-page content width: design uses 1280px frame with 80px L/R padding,
 * yielding a 1120px content area. On mobile we relax horizontal padding to 20px.
 */
export function SiteContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1280px] px-5 md:px-20', className)}
      {...props}
    />
  );
}
