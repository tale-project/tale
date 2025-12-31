'use client';

import type { ReactNode, ComponentType } from 'react';
import { cn } from '@/lib/utils/cn';
import { Stack, VStack, Center } from '@/components/ui/layout';

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
  /** Action menu element (use DataTableActionMenu component) */
  actionMenu?: ReactNode;
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
        {Icon && <Icon className="size-6 text-secondary mb-5" />}
        <div className="text-lg font-semibold leading-tight mb-2">{title}</div>
        {description && (
          <p className="text-sm text-muted-foreground mb-5">{description}</p>
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
 */
export function DataTableFilteredEmptyState({
  title,
  description,
  actionMenu,
  headerContent,
  stickyLayout = false,
  className,
}: DataTableFilteredEmptyStateProps) {
  const content = (
    <Center className={cn('py-16 px-4 text-center', className)}>
      <Stack gap={2}>
        <h4 className="text-base font-semibold text-foreground">{title}</h4>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {actionMenu}
      </Stack>
    </Center>
  );

  // If there's header content, wrap in a container with proper layout
  if (headerContent) {
    return (
      <div
        className={cn(
          stickyLayout ? 'flex flex-col flex-1 min-h-0' : 'space-y-4',
        )}
      >
        <div className={cn(stickyLayout && 'flex-shrink-0 pb-4')}>
          {headerContent}
        </div>
        <div className={cn(stickyLayout && 'flex-1 min-h-0')}>{content}</div>
      </div>
    );
  }

  return content;
}
