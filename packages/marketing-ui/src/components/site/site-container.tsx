import { cn } from '@tale/ui/cn';
import type { HTMLAttributes } from 'react';

/**
 * Shared editorial frame. Gutters grow gradually so tablets retain useful
 * content width instead of inheriting the desktop's side padding.
 */
export function SiteContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[1360px] min-w-0 px-5 sm:px-8 lg:px-12',
        className,
      )}
      {...props}
    />
  );
}
