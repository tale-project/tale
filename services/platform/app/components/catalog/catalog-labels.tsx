'use client';

import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';

/**
 * Definition `labels` as muted outline badges — the ONE label-chip renderer
 * for every catalog card's `meta` slot (automations, skills, integrations)
 * and the detail panel/page headers, so labels read identically everywhere.
 */
export function CatalogLabels({ labels }: { labels?: string[] }) {
  if (!labels || labels.length === 0) return null;
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
