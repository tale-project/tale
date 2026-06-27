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
 * Deliberately button-less: a table's empty state shows only icon + title +
 * description. The create/add affordance lives in the table header, not in the
 * empty body — so the empty state never competes with (or duplicates) it.
 */
export function DataTableEmptyState({
  icon,
  title,
  description,
  headingLevel,
}: DataTableEmptyStateProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      headingLevel={headingLevel}
    />
  );
}
