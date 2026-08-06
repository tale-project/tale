import { Badge } from '@tale/ui/badge';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { TASK_STATUS_BADGE_VARIANT, type TaskStatus } from '../lib/display';

/** Dot fill colours — mirror `@tale/ui` Badge `dotVariants` so compact rows
 *  match the labelled status chip without wrapping the dot in a Badge shell. */
const STATUS_DOT_CLASS: Record<
  (typeof TASK_STATUS_BADGE_VARIANT)[TaskStatus],
  string
> = {
  outline: 'bg-gray-600',
  destructive: 'bg-red-600',
  orange: 'bg-orange-600',
  yellow: 'bg-yellow-600',
  blue: 'bg-blue-600',
  green: 'bg-green-600',
};

/**
 * Status chip. Default is the labelled badge used on the board and status
 * picker. Pass `compact` in narrow rows (dependency links in the side panel)
 * so only a coloured status dot takes space — the label lives in a tooltip
 * and `aria-label`, leaving the title room to read.
 */
export function TaskStatusBadge({
  status,
  compact = false,
}: {
  status: TaskStatus;
  /** Bare status-coloured dot for tight layouts; label via tooltip / aria. */
  compact?: boolean;
}) {
  const { t } = useT('tasks');
  const label = t(`status.${status}`);
  const variant = TASK_STATUS_BADGE_VARIANT[status];

  if (compact) {
    return (
      <Tooltip content={label}>
        <span className="inline-flex shrink-0 items-center" aria-label={label}>
          <span
            className={cn('size-1.5 rounded-full', STATUS_DOT_CLASS[variant])}
            aria-hidden="true"
          />
          <span className="sr-only">{label}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <Badge variant={variant} dot>
      {label}
    </Badge>
  );
}
