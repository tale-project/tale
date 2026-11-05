'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { X } from 'lucide-react';

export interface MetricsFilterChip {
  /** Stable key for React. */
  key: string;
  /** Already-translated chip label, e.g. "Agent: support-bot". */
  label: string;
  /** Clears just this filter. */
  onClear: () => void;
}

interface MetricsFilterChipsProps {
  chips: MetricsFilterChip[];
  onClearAll: () => void;
  /** Already-translated "Clear all" label. */
  clearAllLabel: string;
}

/**
 * The shared active-filter row used across metrics surfaces (usage, feedback).
 * Renders nothing when there are no active filters. Caller supplies already-
 * translated labels so this stays i18n-agnostic and reusable anywhere.
 */
export function MetricsFilterChips({
  chips,
  onClearAll,
  clearAllLabel,
}: MetricsFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <HStack gap={2} className="flex-wrap items-center">
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant="outline"
          className="cursor-pointer"
          onClick={chip.onClear}
        >
          {chip.label}
          <X className="ml-1 size-3" />
        </Badge>
      ))}
      <Button variant="ghost" size="sm" onClick={onClearAll}>
        {clearAllLabel}
      </Button>
    </HStack>
  );
}
