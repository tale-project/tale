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
  /** Whether this is a "no results" state (filters applied but no matches) */
  isFiltered?: boolean;
}

/**
 * Unified empty state component for DataTable.
 *
 * Supports two modes:
 * 1. Initial empty state - when there's no data at all (shows icon + CTA)
 * 2. Filtered empty state - when filters are applied but no results match
 */
export function DataTableEmptyState({
  icon: Icon,
  title,
  description,
  actionMenu,
  className,
  isFiltered = false,
}: DataTableEmptyStateProps) {
  if (isFiltered) {
    return (
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
  }

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
