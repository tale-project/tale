import { Badge } from '@tale/ui/badge';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { cn } from '@/lib/utils/cn';

/**
 * Compact label display for tables and cards: one badge showing the first
 * label, with a "+n" suffix when more exist. The tooltip lists the remaining
 * labels comma-separated.
 *
 * Labels are flat and equal — the first is shown only because horizontal space
 * is finite, not because it ranks above the others. Drop this anywhere a
 * config row (agent / workflow / connector) needs its labels.
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
  const text = rest.length > 0 ? `${first} +${rest.length}` : first;

  const badge = (
    <Badge
      variant="outline"
      className="max-w-32 truncate text-xs font-normal"
      title={labels.join(', ')}
    >
      {text}
    </Badge>
  );

  if (rest.length === 0) {
    return (
      <span className={cn('inline-flex max-w-full min-w-0', className)}>
        {badge}
      </span>
    );
  }

  return (
    <Tooltip content={rest.join(', ')}>
      <span
        className={cn(
          'inline-flex max-w-full min-w-0 cursor-default',
          className,
        )}
      >
        {badge}
      </span>
    </Tooltip>
  );
}
