import { EmptyState } from '@tale/ui/empty-state';
import type { ComponentType, ReactNode } from 'react';

export interface DataTableEmptyStateProps {
  /** Icon to display */
  icon?: ComponentType<{ className?: string }>;
  /** Title text */
  title: string;
  /** Description text or rich content */
  description?: ReactNode;
  /**
   * Optional primary action (e.g. create). When the table is empty and has no
   * search/filter chrome, DataTable moves `addAction` here so the CTA sits
   * with the empty copy instead of a lone toolbar button above an empty grid.
   */
  action?: ReactNode;
  /**
   * Heading level for the empty-state title. Defaults (via `EmptyState`) to
   * `3`, which is correct for the common case of a table inside a settings
   * section (under an `h2`). A table rendered directly under a page `h1` with
   * no intervening section heading should pass `2` to avoid an `h1`→`h3` skip.
   */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Empty state rendered inside DataTable. A thin adapter over the shared
 * [`EmptyState`](../../../../../../packages/ui/src/components/feedback/empty-state.tsx)
 * primitive so every table's empty state looks exactly like the empty states
 * used everywhere else.
 *
 * When the table has toolbar chrome (search/filters), the create affordance
 * stays in the header. When the only chrome would be a lone `addAction`,
 * DataTable passes that button here so empty lists don't show a header button
 * floating above an empty grid.
 */
export function DataTableEmptyState({
  icon,
  title,
  description,
  action,
  headingLevel,
}: DataTableEmptyStateProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      headingLevel={headingLevel}
    />
  );
}
