import { cn } from '@tale/ui/cn';
import type { ReactNode, Ref } from 'react';

interface StickyHeaderProps {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
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
export function StickyHeader({ children, className, ref }: StickyHeaderProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-background/80 short-viewport:static sticky top-0 z-50 flex-shrink-0 backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}
