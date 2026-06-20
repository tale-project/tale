import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { cn } from '@/lib/utils/cn';

/**
 * Compact label display for tables and cards: the first label as a badge, plus
 * a "…" badge whose tooltip lists the remaining labels comma-separated.
 *
 * Labels are flat and equal — the first is shown only because horizontal space
 * is finite, not because it ranks above the others. Drop this anywhere a
 * config row (agent / workflow / integration) needs its labels.
 */
export function LabelBadges({
  labels,
  className,
}: {
  labels: string[];
  className?: string;
}) {
  if (labels.length === 0) return null;
  const [first, ...rest] = labels;
  return (
    <HStack gap={1} className={cn('flex-wrap', className)}>
      <Badge variant="outline" className="text-xs font-normal">
        {first}
      </Badge>
      {rest.length > 0 ? (
        <Tooltip content={rest.join(', ')}>
          <span className="inline-flex cursor-default">
            <Badge
              variant="outline"
              className="text-muted-foreground text-xs font-normal"
            >
              …
            </Badge>
          </span>
        </Tooltip>
      ) : null}
    </HStack>
  );
}
