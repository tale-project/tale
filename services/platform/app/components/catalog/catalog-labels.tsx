'use client';

import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';

/**
 * Definition `labels` — the ONE label renderer for catalog cards and detail
 * headers. Cards use `tone="quiet"` (muted inline text under the title, like
 * Claude's brand line); panels/headers keep outline badges.
 */
export function CatalogLabels({
  labels,
  tone = 'badge',
}: {
  labels?: string[];
  /** `quiet` = muted "A · B" under a card title; `badge` = outline chips. */
  tone?: 'badge' | 'quiet';
}) {
  if (!labels || labels.length === 0) return null;
  if (tone === 'quiet') {
    return (
      <p className="text-muted-foreground line-clamp-1 text-xs leading-4">
        {labels.join(' · ')}
      </p>
    );
  }
  return (
    <HStack gap={1} className="flex-wrap">
      {labels.map((label) => (
        <Badge key={label} variant="outline">
          {label}
        </Badge>
      ))}
    </HStack>
  );
}
