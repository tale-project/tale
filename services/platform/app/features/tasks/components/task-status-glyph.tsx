import { cn } from '@tale/ui/cn';
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleEllipsis,
  CircleX,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { TaskStatus } from '../lib/display';

/** One glyph per status, in the status's own colour — how a task reads at a
 * glance wherever it is listed or opened. */
const TASK_STATUS_GLYPH: Record<
  TaskStatus,
  { icon: LucideIcon; tone: string }
> = {
  backlog: { icon: CircleDashed, tone: 'text-muted-foreground' },
  todo: { icon: Circle, tone: 'text-blue-500' },
  in_progress: { icon: CircleDot, tone: 'text-amber-500' },
  in_review: { icon: CircleEllipsis, tone: 'text-orange-500' },
  done: { icon: CircleCheck, tone: 'text-green-600 dark:text-green-500' },
  cancelled: { icon: CircleX, tone: 'text-muted-foreground' },
};

export function TaskStatusGlyph({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const { icon: Icon, tone } = TASK_STATUS_GLYPH[status];
  return <Icon aria-hidden className={cn('size-4', tone, className)} />;
}

type StatusIcon = ComponentType<{ className?: string }>;

const STATUS_ICONS = new Map<TaskStatus, StatusIcon>();

/**
 * The status glyph as a component of its own, for a list that takes an icon
 * component rather than an element — the search palette's rows. One stable
 * component per status, so a re-render never remounts it.
 */
export function taskStatusIcon(status: TaskStatus): StatusIcon {
  const known = STATUS_ICONS.get(status);
  if (known !== undefined) return known;
  const { icon: Icon, tone } = TASK_STATUS_GLYPH[status];
  const StatusGlyphIcon = ({ className }: { className?: string }) => (
    <Icon aria-hidden className={cn(tone, className)} />
  );
  STATUS_ICONS.set(status, StatusGlyphIcon);
  return StatusGlyphIcon;
}
