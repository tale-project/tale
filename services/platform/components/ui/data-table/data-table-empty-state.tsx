'use client';

import type { ReactNode, ComponentType } from 'react';
import { cn } from '@/lib/utils/cn';
import { VStack, Center } from '@/components/ui/layout/layout';

/** Icon component type that accepts className prop */
export type IconComponent = ComponentType<{ className?: string }>;

export interface DataTableEmptyStateProps {
  /** Icon to display */
  icon?: IconComponent;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action menu element (use DataTableActionMenu component) */
  actionMenu?: ReactNode;
  /** Additional class name */
  className?: string;
}

export interface DataTableFilteredEmptyStateProps {
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Header content (search, filters) */
  headerContent?: ReactNode;
  /** Whether to use sticky layout */
  stickyLayout?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * Initial empty state component for DataTable.
 * Shows when there's no data at all (displays icon, border, and CTA).
 */
export function DataTableEmptyState({
  icon: Icon,
  title,
  description,
  actionMenu,
  className,
}: DataTableEmptyStateProps) {
  return (
    <Center
      className={cn(
        'flex-[1_1_0] ring-1 ring-border rounded-xl p-4',
        className,
      )}
    >
      <VStack align="center" className="text-center max-w-[24rem]">
        {Icon && <Icon className="size-6 text-secondary mb-4" />}
        <div className="text-lg font-semibold leading-tight mb-1">{title}</div>
        {description && (
          <p
            className={cn(
              'text-sm text-muted-foreground',
              actionMenu && 'mb-4',
            )}
          >
            {description}
          </p>
        )}
        {actionMenu}
      </VStack>
    </Center>
  );
}

/**
 * Filtered empty state component for DataTable.
 * Shows when filters are applied but no results match.
 * Includes header content (search/filters) and simpler styling.
 * Note: No action button since it's already in the header.
 */
export function DataTableFilteredEmptyState({
  title,
  description,
  headerContent,
  stickyLayout = false,
  className,
}: DataTableFilteredEmptyStateProps) {
  const content = (
    <VStack align="center" className={cn('text-center', className)}>
      <h4 className="text-base font-semibold text-foreground mb-1">{title}</h4>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </VStack>
  );

  // If there's header content, wrap in a container with proper layout
  if (headerContent) {
    return (
      <>
        <div className={cn(stickyLayout && 'flex-shrink-0 pb-4')}>
          {headerContent}
        </div>
        <Center
          className={cn(
            'rounded-xl border border-border',
            stickyLayout ? 'flex-1 min-h-0' : 'py-16',
          )}
        >
          {content}
        </Center>
      </>
    );
  }

  return <Center className="py-16">{content}</Center>;
}
