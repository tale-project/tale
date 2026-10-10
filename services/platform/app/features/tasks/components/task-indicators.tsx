'use client';

import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { useFormatDate } from '@tale/ui/use-format-date';
import {
  Ban,
  CalendarClock,
  CalendarSync,
  MessageSquare,
  Repeat,
} from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { type TaskRepeat, taskRepeatCreateOn } from '@/lib/shared/task-repeat';

import { TASK_TERMINAL_STATUSES, isTaskStatus } from '../lib/display';
import { useTaskRepeatLabel } from '../lib/task-repeat-label';

// Each indicator below is a guard and a chip: the guard decides from its
// props alone, so a card pays for the translations and formatters of the
// chips it shows, not of the ten it could show.

export function useTaskCardStateLabels() {
  const { t } = useT('tasks');
  return {
    blocked: t('detail.blocked'),
    comments: (count: number) => t('detail.commentCount', { count }),
    review: (reviewerName?: string, reviewerIsMe = false) =>
      reviewerIsMe
        ? t('review.waitingOnYou')
        : reviewerName !== undefined
          ? t('review.waitingOn', { name: reviewerName })
          : t('review.needsReview'),
  };
}

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
  return blocked ? <BlockedChip className={className} /> : null;
}

function BlockedChip({ className }: { className?: string }) {
  const labels = useTaskCardStateLabels();
  return (
    <Tooltip content={labels.blocked}>
      <span
        className={cn(
          'inline-flex items-center text-amber-600 dark:text-amber-400',
          className,
        )}
        aria-label={labels.blocked}
        role="img"
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
  return count && count > 0 ? (
    <CommentCountChip count={count} className={className} />
  ) : null;
}

function CommentCountChip({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const labels = useTaskCardStateLabels();
  const label = labels.comments(count);
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'text-muted-foreground inline-flex items-center gap-0.5 text-xs',
          className,
        )}
        aria-label={label}
        role="img"
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
  return total > 0 ? (
    <SubtaskProgressRing done={done} total={total} className={className} />
  ) : null;
}

function SubtaskProgressRing({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const { t } = useT('tasks');
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
        role="img"
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
 * Repeat glyph shown on a task card/row that comes back when it closes; the
 * tooltip names the rule. Only an open task that still carries its series
 * shows it: one that already continued it (on its due date, while still
 * open) never continues it again, even once that next task is deleted, and
 * a closed one without a next task will not come back. Renders nothing
 * otherwise.
 */
export function RepeatIndicator({
  repeat,
  status,
  continued,
  className,
}: {
  repeat?: TaskRepeat;
  status: string;
  /** Whether the task has continued its series (`repeatContinued`). */
  continued?: boolean;
  className?: string;
}) {
  const open = isTaskStatus(status) && !TASK_TERMINAL_STATUSES.has(status);
  return repeat && continued !== true && open ? (
    <RepeatChip repeat={repeat} className={className} />
  ) : null;
}

function RepeatChip({
  repeat,
  className,
}: {
  repeat: TaskRepeat;
  className?: string;
}) {
  const { t } = useT('tasks');
  const repeatLabel = useTaskRepeatLabel();
  const label = t('repeat.indicator', { rule: repeatLabel(repeat) });
  // The same glyph the Repeat row shows: a series that also creates its
  // next task on the due date reads differently at a glance.
  const Glyph =
    taskRepeatCreateOn(repeat) === 'dueDate' ? CalendarSync : Repeat;
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'text-muted-foreground inline-flex items-center',
          className,
        )}
        aria-label={label}
        role="img"
      >
        <Glyph className="size-3.5 shrink-0" aria-hidden="true" />
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
  return dueDate === undefined ? null : (
    <DueDateChip dueDate={dueDate} status={status} className={className} />
  );
}

function DueDateChip({
  dueDate,
  status,
  className,
}: {
  dueDate: number;
  status: string;
  className?: string;
}) {
  const { t } = useT('tasks');
  const { formatDate } = useFormatDate();
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
        role="img"
      >
        <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
        {formatDate(date, 'short')}
      </span>
    </Tooltip>
  );
}
