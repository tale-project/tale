import { EmptyState } from '@tale/ui/empty-state';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

interface RulesTableEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

/**
 * Centred empty-state rendered inside a rules table's bordered container.
 * Same EmptyState vocabulary as the rest of the product, with tighter padding
 * for table chrome (matches governance Pencil frames).
 */
export function RulesTableEmptyState({
  icon,
  title,
  description,
  className,
}: RulesTableEmptyStateProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      className={cn('px-5 py-10', className)}
    />
  );
}
