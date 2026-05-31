import { VStack, Center } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ComponentType, ReactNode } from 'react';

export interface DataTableEmptyStateProps {
  /** Icon to display */
  icon?: ComponentType<{ className?: string }>;
  /** Title text */
  title: string;
  /** Description text or rich content */
  description?: ReactNode;
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
      <VStack align="center" className="max-w-[24rem] gap-2 text-center">
        {Icon && (
          <Icon
            className="text-muted-foreground/60 mb-3 size-6"
            aria-hidden="true"
          />
        )}
        <Text variant="label">{title}</Text>
        {/* `as="div"` (not the default <p>): empty-state descriptions can carry
            rich content — links, buttons, doc CTAs wrapped in their own block
            elements — and a <div> inside a <p> is invalid HTML (hydration error). */}
        {description && (
          <Text as="div" variant="muted">
            {description}
          </Text>
        )}
      </VStack>
    </Center>
  );
}
