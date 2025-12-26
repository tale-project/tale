import { cn } from '@/lib/utils/cn';
import { ReactNode } from 'react';
import { HStack } from '@/components/ui/layout';

interface PageHeaderProps {
  children: ReactNode;
  className?: string;
  /**
   * Whether to show a border at the bottom of the header.
   * @default false
   */
  showBorder?: boolean;
}

/**
 * Sticky page header component for section titles.
 * Provides consistent sticky positioning, backdrop blur, and styling.
 */
export function PageHeader({
  children,
  className,
  showBorder = false,
}: PageHeaderProps) {
  return (
    <HStack
      gap={0}
      className={cn(
        'px-4 py-2 sticky top-0 z-50 bg-background/50 backdrop-blur-md min-h-12',
        showBorder && 'border-b border-border',
        className,
      )}
    >
      {children}
    </HStack>
  );
}

interface PageHeaderTitleProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standard title styling for page headers.
 */
export function PageHeaderTitle({ children, className }: PageHeaderTitleProps) {
  return (
    <h1 className={cn('text-base font-semibold text-foreground', className)}>
      {children}
    </h1>
  );
}
