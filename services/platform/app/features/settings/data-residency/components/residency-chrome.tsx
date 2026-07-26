'use client';

/**
 * Tiny display pieces shared by the deployment-store sections and the per-org
 * sections of the data-residency page — split out so the two groups can live
 * in separate files without either importing the other.
 */

import { Badge } from '@tale/ui/badge';

import { Input } from '@/app/components/ui/forms/input';

/** Placeholder for an unset optional value in a read-only field (never blank). */
export const READ_ONLY_EMPTY = '—';

/**
 * A stored value the current caller cannot edit, rendered as a native
 * read-only field so its label and value are exposed to assistive tech (the
 * Input auto-selects its borderless read-only variant). Optional values that
 * are unset show an em-dash rather than an empty box.
 */
export function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return <Input label={label} value={value || READ_ONLY_EMPTY} readOnly />;
}

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
