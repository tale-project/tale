'use client';

import { Ban, Bot, CalendarClock, Eye, MessageSquare } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
    <span
      className={cn(
        'inline-flex items-center text-amber-600 dark:text-amber-400',
        className,
      )}
      title={t('detail.blocked')}
      aria-label={t('detail.blocked')}
    >
      <Ban className="size-3.5 shrink-0" aria-hidden="true" />
    </span>
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
    <span
      className={cn('inline-flex items-center text-primary', className)}
      title={t('agentRuns.working')}
      aria-label={t('agentRuns.working')}
    >
      <Bot className="size-3.5 shrink-0 animate-pulse" aria-hidden="true" />
    </span>
  );
}

/**
 * "Needs review" glyph — the task sits at the review gate waiting for a
 * human decision. Paired with the review card in the detail sheet.
 */
export function NeedsReviewIndicator({
  needsReview,
  className,
}: {
  needsReview: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  if (!needsReview) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center text-blue-600 dark:text-blue-400',
        className,
      )}
      title={t('review.needsReview')}
      aria-label={t('review.needsReview')}
    >
      <Eye className="size-3.5 shrink-0" aria-hidden="true" />
    </span>
  );
}

/**
 * Overdue glyph — dueDate in the past on a non-terminal task. Derived
 * client-side from the row; no extra query.
 */
export function OverdueIndicator({
  dueDate,
  status,
  className,
}: {
  dueDate: number | undefined;
  status: string;
  className?: string;
}) {
  const { t } = useT('tasks');
  const overdue =
    dueDate !== undefined &&
    dueDate < Date.now() &&
    status !== 'done' &&
    status !== 'cancelled';
  if (!overdue) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center text-red-600 dark:text-red-400',
        className,
      )}
      title={t('dueDate.overdue')}
      aria-label={t('dueDate.overdue')}
    >
      <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
    </span>
  );
}
