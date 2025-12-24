import { cn } from '@/lib/utils/cn';
import { ReactNode } from 'react';

interface ContentWrapperProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standard content wrapper for page layouts.
 * Provides consistent padding and flex behavior across all pages.
 */
export function ContentWrapper({ children, className }: ContentWrapperProps) {
  return (
    <div className={cn('flex flex-col flex-[1_1_0] px-4 py-6', className)}>
      {children}
    </div>
  );
}
