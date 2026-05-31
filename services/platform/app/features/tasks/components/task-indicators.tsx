'use client';

import { MessageSquare } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * Small comment-count badge shown on a task card/row. Renders nothing when the
 * task has no comments. Count is read from the denormalized `tasks.commentCount`
 * so the board needs no per-card fetch.
 */
export function CommentCountIndicator({
  count,
  className,
}: {
  count: number | undefined;
  className?: string;
}) {
  const { t } = useT('tasks');
  if (!count || count <= 0) return null;
  return (
    <span
      className={cn(
        'text-muted-foreground inline-flex items-center gap-0.5 text-xs',
        className,
      )}
      title={t('detail.comments')}
      aria-label={`${count} ${t('detail.comments')}`}
    >
      <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}

/**
 * Circular subtask progress (done / total) with a `done/total` caption. Renders
 * nothing when the task has no subtasks. The ring fills proportionally and
 * turns green once every subtask is in a terminal status.
 */
export function SubtaskProgress({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const { t } = useT('tasks');
  if (total <= 0) return null;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(1, Math.max(0, done / total));
  const complete = done >= total;
  return (
    <span
      className={cn(
        'text-muted-foreground inline-flex items-center gap-1 text-xs',
        className,
      )}
      title={t('detail.subtasks')}
      aria-label={`${done}/${total} ${t('detail.subtasks')}`}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          strokeWidth="2"
          className="stroke-border"
        />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className={complete ? 'stroke-green-500' : 'stroke-primary'}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}
