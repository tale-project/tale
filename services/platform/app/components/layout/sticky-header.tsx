import { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface StickyHeaderProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wrapper component that provides unified sticky positioning and blur effect
 * for page headers with tab navigation.
 */
export function StickyHeader({ children, className }: StickyHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-50 bg-background/80 flex-shrink-0 backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}
