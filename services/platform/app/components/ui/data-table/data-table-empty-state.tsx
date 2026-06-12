import { Button } from '@tale/ui/button';
import { VStack, Center } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

/** A single primary call-to-action shown under the empty-state copy. */
export interface DataTableEmptyStateAction {
  label: string;
  onClick: () => void;
  // Matches Button's `icon` prop; the empty-state CTA renders a Button.
  icon?: LucideIcon;
}

export interface DataTableEmptyStateProps {
  /** Icon to display */
  icon?: ComponentType<{ className?: string }>;
  /** Title text */
  title: string;
  /** Description text or rich content */
  description?: ReactNode;
  /**
   * Optional primary action (e.g. "Create your first agent"). Keep it to a
   * single obvious next step — an empty list should point at one clear thing.
   */
  action?: DataTableEmptyStateAction;
}

/**
 * Empty state component rendered inside DataTable.
 * Shows when there's no data at all (highest priority — displayed regardless of active filters).
 */
export function DataTableEmptyState({
  icon: Icon,
  title,
  description,
  action,
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
        {action && (
          <Button
            variant="primary"
            size="sm"
            icon={action.icon}
            onClick={action.onClick}
            className="mt-3"
          >
            {action.label}
          </Button>
        )}
      </VStack>
    </Center>
  );
}
