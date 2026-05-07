import { cn } from '@tale/ui/cn';
import type { ComponentProps } from 'react';

interface SkipLinkProps extends ComponentProps<'a'> {
  /** Defaults to `#main`. */
  targetId?: string;
}

/**
 * First focusable element on every page. Hidden until focused, then
 * appears as a high-contrast button that jumps to the page's `<main>`.
 */
export function SkipLink({
  targetId = 'main',
  className,
  children,
  ...rest
}: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'bg-fg-base text-bg-base sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}
