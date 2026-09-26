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
