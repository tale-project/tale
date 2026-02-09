'use client';

import type { ReactNode, ComponentType } from 'react';

import { VStack, Center } from '@/app/components/ui/layout/layout';
import { cn } from '@/lib/utils/cn';

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
      <VStack align="center" className="max-w-[24rem] text-center">
        {Icon && <Icon className="text-secondary mb-4 size-6" />}
        <div className="mb-1 text-lg leading-tight font-semibold">{title}</div>
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
