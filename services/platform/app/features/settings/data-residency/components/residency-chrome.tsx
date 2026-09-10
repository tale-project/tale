'use client';

/**
 * Tiny display pieces shared by the deployment-store sections and the per-org
 * sections of the data-residency page — split out so the two groups can live
 * in separate files without either importing the other.
 */

import { Badge } from '@tale/ui/badge';

/** Placeholder for an unset optional value in a read-only field (never blank). */
export const READ_ONLY_EMPTY = '—';

/** The on/off state of a store, as a scannable status pill. */
export function StatusBadge({
  enabled,
  onLabel,
  offLabel,
}: {
  enabled: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <Badge variant={enabled ? 'blue' : 'slate'} dot>
      {enabled ? onLabel : offLabel}
    </Badge>
  );
}
