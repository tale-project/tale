'use client';

import { Ban, Bot, CalendarClock, Eye, MessageSquare } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { TASK_TERMINAL_STATUSES, isTaskStatus } from '../lib/display';

/**
 * Amber "blocked" glyph shown on a task card/row when the task has at least one
 * unfinished blocker (computed from dependency edges, see `lib/dependencies`).
 * Renders nothing when the task isn't blocked. Colour is paired with the icon
 * shape + label so it never relies on colour alone.
 */
export function BlockedIndicator({
  blocked,
  className,
}: {
  blocked: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  if (!blocked) return null;
  return (
    <Tooltip content={t('detail.blocked')}>
      <span
        className={cn(
          'inline-flex items-center text-amber-600 dark:text-amber-400',
          className,
        )}
        aria-label={t('detail.blocked')}
      >
        <Ban className="size-3.5 shrink-0" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

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
  const label = `${count} ${t('detail.comments')}`;
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'text-muted-foreground inline-flex items-center gap-0.5 text-xs',
          className,
        )}
        aria-label={label}
      >
        <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{count}</span>
      </span>
    </Tooltip>
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
  const label = `${done}/${total} ${t('detail.subtasks')}`;
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'text-muted-foreground inline-flex items-center gap-1 text-xs',
          className,
        )}
        aria-label={label}
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
    </Tooltip>
  );
}

/**
 * Pulsing "agent is working" glyph — shown while the task has a live agent
 * run (`getTaskOpsIndicators`). The pulse is the acknowledgment signal of
 * the task-ops pack: assignment should never look dead.
 */
export function AgentWorkingIndicator({
  working,
  className,
}: {
  working: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  if (!working) return null;
  return (
    <Tooltip content={t('agentRuns.working')}>
      <span
        className={cn('text-primary inline-flex items-center', className)}
        aria-label={t('agentRuns.working')}
      >
        <Bot className="size-3.5 shrink-0 animate-pulse" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

/**
 * "Needs review" chip — the task sits at the review gate waiting for a
 * human decision. Paired with the review card in the detail sheet. When the
 * waiting-on reviewer is known it is NAMED ("You" for the viewer), following
 * the DueDateIndicator glyph+text pattern; without one the bare glyph keeps
 * the pre-reviewer behavior.
 */
export function NeedsReviewIndicator({
  needsReview,
  reviewerName,
  reviewerIsMe = false,
  className,
}: {
  needsReview: boolean;
  /** Display name of the reviewer the task waits on, when resolved. */
  reviewerName?: string;
  /** True when the viewer IS the reviewer — renders "You" instead of the name. */
  reviewerIsMe?: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  if (!needsReview) return null;
  const label = reviewerIsMe
    ? t('review.waitingOnYou')
    : reviewerName !== undefined
      ? t('review.waitingOn', { name: reviewerName })
      : t('review.needsReview');
  const text = reviewerIsMe ? t('assignee.you') : reviewerName;
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400',
          className,
        )}
        aria-label={label}
      >
        <Eye className="size-3.5 shrink-0" aria-hidden="true" />
        {text !== undefined && (
          <span className="max-w-24 truncate">{text}</span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * Due date chip — calendar glyph + short date, red once the dueDate is in the
 * past on a non-terminal task. The tooltip carries the full date (and the
 * overdue note) so the compact chip stays scannable. Renders nothing without
 * a due date. Used by both the board card and the list row.
 */
export function DueDateIndicator({
  dueDate,
  status,
  className,
}: {
  dueDate: number | undefined;
  status: string;
  className?: string;
}) {
  const { t } = useT('tasks');
  const { formatDate } = useFormatDate();
  if (dueDate === undefined) return null;
  const overdue =
    dueDate < Date.now() &&
    (!isTaskStatus(status) || !TASK_TERMINAL_STATUSES.has(status));
  const date = new Date(dueDate);
  const tooltip = overdue
    ? `${t('dueDate.due', { date: formatDate(date, 'long') })} · ${t('dueDate.overdue')}`
    : t('dueDate.due', { date: formatDate(date, 'long') });
  return (
    <Tooltip content={tooltip}>
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs tabular-nums',
          overdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
          className,
        )}
        aria-label={tooltip}
      >
        <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
        {formatDate(date, 'short')}
      </span>
    </Tooltip>
  );
}
