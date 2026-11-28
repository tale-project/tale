'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface MobileAppHeaderProps extends HTMLAttributes<HTMLElement> {
  /** Left slot — typically a menu trigger or back button. */
  start?: ReactNode;
  /** Center slot — typically a title or breadcrumb. */
  children?: ReactNode;
  /** Right slot — typically action buttons (search, options). */
  end?: ReactNode;
  /** Accessible label for the banner landmark. */
  ariaLabel?: string;
}

/**
 * Sticky-top mobile header with safe-area-aware top padding so it clears the
 * iOS notch / dynamic island. Three slots — left, center, right — sized 44×44
 * minimum on the action edges to meet WCAG 2.1 Level AA touch targets.
 *
 * Hidden on `md+` viewports — desktop renders the existing platform topbar.
 */
export const MobileAppHeader = forwardRef<HTMLElement, MobileAppHeaderProps>(
  ({ start, end, children, ariaLabel, className, ...props }, ref) => (
    <header
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        'bg-background/95 border-border sticky top-0 z-40 flex items-center border-b backdrop-blur-md md:hidden',
        'pt-(--safe-top) pr-(--safe-right) pl-(--safe-left)',
        className,
      )}
      {...props}
    >
      <div className="flex min-h-11 flex-1 items-center gap-2 px-3">
        {start && (
          <div className="flex min-h-11 min-w-11 items-center justify-center">
            {start}
          </div>
        )}
        <div className="flex-1 truncate text-base font-semibold">
          {children}
        </div>
        {end && (
          <div className="flex min-h-11 items-center justify-end gap-1">
            {end}
          </div>
        )}
      </div>
    </header>
  ),
);
MobileAppHeader.displayName = 'MobileAppHeader';
