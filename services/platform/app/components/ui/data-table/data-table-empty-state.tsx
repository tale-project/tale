import type { ComponentType } from 'react';

import { VStack, Center } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';

export interface DataTableEmptyStateProps {
  /** Icon to display */
  icon?: ComponentType<{ className?: string }>;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
}

/**
 * Empty state component rendered inside DataTable.
 * Shows when there's no data at all (highest priority — displayed regardless of active filters).
 */
export function DataTableEmptyState({
  icon: Icon,
  title,
  description,
}: DataTableEmptyStateProps) {
  return (
    <Center className="flex-[1_1_0] py-12">
      <VStack align="center" className="max-w-[24rem] text-center">
        {Icon && (
          <Icon
            className="text-muted-foreground/60 mb-3 size-10"
            aria-hidden="true"
          />
        )}
        <Text variant="label">{title}</Text>
        {description && <Text variant="muted">{description}</Text>}
      </VStack>
    </Center>
  );
}
