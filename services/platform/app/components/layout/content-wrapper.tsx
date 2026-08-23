import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface ContentWrapperProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standard content wrapper for page layouts.
 * Provides consistent flex behavior across all pages.
 * Consumers should apply padding via the className prop as needed.
 * Uses min-h-0 to allow children to control their own overflow.
 */
export function ContentWrapper({ children, className }: ContentWrapperProps) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {children}
    </div>
  );
}
