import { cn } from '@tale/ui/cn';
import type { ComponentProps, MouseEvent } from 'react';

interface SkipLinkProps extends ComponentProps<'a'> {
  /** Defaults to `#main`. */
  targetId?: string;
}

/**
 * First focusable element on every page. Hidden until focused, then
 * appears as a high-contrast button that jumps to the page's `<main>`.
 *
 * Activation moves focus into the target explicitly: native fragment focus —
 * the browser focusing a `tabIndex={-1}` target after a `#main` navigation —
 * is unreliable (some browsers only scroll, headless Chromium doesn't move
 * focus at all), which would strand keyboard and screen-reader users on the
 * link. The hash still updates when the target is missing.
 */
export function SkipLink({
  targetId = 'main',
  className,
  children,
  onClick,
  ...rest
}: SkipLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
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
