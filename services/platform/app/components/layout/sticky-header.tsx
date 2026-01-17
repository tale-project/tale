import { cn } from '@/lib/utils/cn';
import { ReactNode } from 'react';

interface StickyHeaderProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wrapper component that provides unified sticky positioning and blur effect
 * for page headers with tab navigation.
 *
 * Uses inline styles for backdrop-filter to ensure Safari compatibility
 * (-webkit-backdrop-filter is required for Safari).
 */
export function StickyHeader({ children, className }: StickyHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-50 bg-background/80 flex-shrink-0',
        className,
      )}
      style={{
        WebkitBackdropFilter: 'blur(12px)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {children}
    </div>
  );
}
