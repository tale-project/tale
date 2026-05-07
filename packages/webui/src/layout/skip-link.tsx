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
        'bg-fg-base text-bg-base sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none',
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}
