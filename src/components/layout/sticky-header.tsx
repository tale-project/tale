import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

interface StickyHeaderProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wrapper component that provides unified sticky positioning and blur effect
 * for page headers with tab navigation.
 *
 * On a short viewport (`short-viewport:`) the header scrolls away with the
 * page: pinned, a title row and a tab strip held half of a phone held
 * sideways, and the page scrolled in what was left.
 */
export function StickyHeader({ children, className }: StickyHeaderProps) {
  return (
    <div
      className={cn(
        'bg-background/80 short-viewport:static sticky top-0 z-50 flex-shrink-0 backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}
