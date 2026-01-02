import { cn } from '@/lib/utils/cn';
import { ReactNode } from 'react';

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
        'sticky top-0 z-50 bg-background/50 backdrop-blur-md flex-shrink-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
