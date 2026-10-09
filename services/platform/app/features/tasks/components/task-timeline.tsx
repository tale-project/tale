'use client';

import {
  taskAgentReviewReceiptSchema,
  taskReviewerSchema,
} from '@tale/shared/schemas/task-review';
import { mentionPlainText } from '@tale/ui/mentions/scan-mentions';
import { ThreadEvent, ThreadEventActor } from '@tale/ui/thread/thread-event';
import { ThreadTime } from '@tale/ui/thread/thread-time';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import {
  Ban,
  Bot,
  CalendarDays,
  CheckCheck,
  CircleDot,
  Link2,
  Paperclip,
  PenLine,
  Repeat,
  SignalHigh,
  Tag,
  UserCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { MENTION_KINDS } from '@/lib/shared/mention-handles';
import { parseTaskRepeat, type TaskRepeat } from '@/lib/shared/task-repeat';

import { useTaskActivity, useTaskAgentRuns } from '../hooks/queries';
import {
  useTaskActorDirectory,
  useTaskMentionActors,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';
import {
  TASK_ACTIVITY_FIELD,
  TASK_ACTIVITY_LABEL_KEY,
  TASK_PRIORITY_LABEL_KEY,
  TASK_RUN_REFUSAL_LABEL_KEY,
  isTaskStatus,
} from '../lib/display';
import { useTaskRepeatLabel } from '../lib/task-repeat-label';
import {
  isPreviewableTaskActor,
  isWorkflowSentinel,
} from '../utils/task-actor-preview';
import {
  inferWorkflowContextFromRuns,
  mergeTaskTimeline,
} from '../utils/task-timeline';
import { TaskActorName } from './task-actor-preview-popover';
import { TaskAgentRunStatusBadge } from './task-agent-run-status-badge';
import { TaskStatusGlyph } from './task-status-glyph';

/** An agent run's cost, as the conversation and the details panel show it. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type TimelineItem = ReturnType<typeof mergeTaskTimeline>[number];

/** How much of a changed text a timeline line quotes. A description change
 *  records both whole descriptions (up to 20,000 characters each), and a
 *  line that printed them both was a wall of text — and seconds of layout on
 *  a task with a few of them. */
const ACTIVITY_TEXT_MAX = 160;

function quoteActivityText(value: string): string {
  return value.length > ACTIVITY_TEXT_MAX
    ? `${value.slice(0, ACTIVITY_TEXT_MAX).trimEnd()}…`
    : value;
}

/**
 * The rule a `repeat.changed` row stored (as JSON), with when it creates its
 * next task. Its zone is set aside before validating: the label never reads
 * it, and a zone this runtime no longer knows must not turn a real rule into
 * "Never".
 */
function storedRepeatRule(value: string): TaskRepeat | null {
  let stored: unknown;
  try {
    stored = JSON.parse(value);
  } catch (error) {
    console.warn('[tasks] unreadable repeat rule in the activity log', error);
    return null;
  }
  if (typeof stored !== 'object' || stored === null) return null;
  return parseTaskRepeat({ ...stored, timezone: 'UTC' });
}

/** A task's activity and its agent runs, merged newest first, with the runs'
 * total cost — what the conversation and the details panel read. */
export function useTaskTimeline(taskId: string) {
  const { activity } = useTaskActivity(taskId);
  const { runs } = useTaskAgentRuns(taskId);
  const timeline = useMemo(
    () => mergeTaskTimeline(activity, runs),
    [activity, runs],
  );
  const totalCostCents = useMemo(
    () => runs.reduce((sum, run) => sum + run.costCents, 0),
    [runs],
  );
  return { timeline, runs, totalCostCents };
}

/** When a timeline item happened — what a merged, time-ordered view sorts by. */
export function timelineItemTime(item: TimelineItem): number {
  return item.kind === 'agentRun' ? item.run.startedAt : item.entry.createdAt;
}

export function timelineItemKey(item: TimelineItem): string {
  return item.kind === 'agentRun' ? `run-${item.run.runId}` : item.entry._id;
}

/** The gutter glyph of an activity line: what kind of change it was. */
function activityIcon(action: string, kind: string | undefined): LucideIcon {
  if (action.startsWith('attachment')) return Paperclip;
  if (action.startsWith('dependency')) return Link2;
  if (action === 'labels.changed') return Tag;
  switch (kind) {
    case 'person':
      return UserRound;
    case 'priority':
      return SignalHigh;
    case 'reviewer':
      return UserCheck;
    case 'reviewDecision':
      return CheckCheck;
    case 'date':
      return CalendarDays;
    case 'repeat':
      return Repeat;
    case 'refusal':
      return Ban;
    case 'text':
      return action === 'repeat.next' ? Repeat : PenLine;
    default:
      return CircleDot;
  }
}

/**
 * One line of a task's history: an agent run (who, how it went, how long,
 * what it cost) or an activity entry (who changed what, from → to). Rendered
 * as a quiet single line, so it reads as the event it is between comments.
 */
export const TaskTimelineEntry = withTaskActorDirectory(
  TaskTimelineEntryContent,
);

function TaskTimelineEntryContent({
  item,
  runs,
  organizationId,
  projectId,
  timeFormat = 'relative',
}: {
  item: TimelineItem;
  runs: ReturnType<typeof useTaskAgentRuns>['runs'];
  organizationId: string;
  projectId: string;
  /** `time` under a day divider; `relative` where nothing names the day. */
  timeFormat?: 'time' | 'relative';
}) {
  const { t } = useT('tasks');
  const {
    resolveActor,
    resolveAssigneeId,
    resolveActorPreview,
    resolveAgentRunPreview,
    resolveWorkflowRunPreview,
  } = useTaskActorDirectory(organizationId, projectId);
  const mentions = useTaskMentionActors(organizationId, projectId);
  const { formatDate } = useFormatDate();
  const repeatLabel = useTaskRepeatLabel();
  const { never: repeatNever } = useRecurrenceFormat();

  if (item.kind === 'agentRun') {
    const { run } = item;
    const agentPreview = resolveAgentRunPreview(run);
    const workflowPreview = resolveWorkflowRunPreview(run);
    // The agent whose run put this one to work (`task_start_agent`).
    const delegatorPreview =
      run.delegatedByAgentId !== undefined
        ? resolveActorPreview('agent', run.delegatedByAgentId)
        : null;
    const delegatorName =
      run.delegatedByAgentId !== undefined
        ? resolveActor('agent', run.delegatedByAgentId).name
        : undefined;
    return (
      <ThreadEvent
        className="[contain-intrinsic-block-size:auto_1.5rem] [content-visibility:auto]"
        glyph={
          <span
            className="bg-primary/10 text-primary inline-flex size-5 items-center justify-center rounded-full"
            aria-hidden
          >
            <Bot className="size-3" />
          </span>
        }
        time={<ThreadTime value={run.startedAt} format={timeFormat} />}
        trailing={
          <TaskAgentRunStatusBadge run={run} agentName={agentPreview.name} />
        }
      >
        <ThreadEventActor>
          <TaskActorName preview={agentPreview} name={agentPreview.name} />
        </ThreadEventActor>{' '}
        {t('timeline.runLabel')}
        <span aria-hidden="true"> · </span>
        <span>
          {t(`agentRuns.trigger.${run.trigger}`)}
          {run.durationMs !== undefined
            ? ` · ${Math.round(run.durationMs / 1000)}s`
            : ''}
          {run.costCents > 0 ? ` · ${formatCents(run.costCents)}` : ''}
        </span>
        {workflowPreview ? (
          <>
            <span aria-hidden="true"> · </span>
            <TaskActorName
              preview={workflowPreview}
              name={workflowPreview.name}
            />
          </>
        ) : null}
        {delegatorName !== undefined ? (
          <>
            <span aria-hidden="true"> · </span>
            {t('timeline.startedByAgent')}{' '}
            <TaskActorName preview={delegatorPreview} name={delegatorName} />
          </>
        ) : null}
      </ThreadEvent>
    );
  }

  const { entry } = item;
  const labelKey = TASK_ACTIVITY_LABEL_KEY[entry.action];
  const label = labelKey ? t(labelKey) : entry.action;
  const actor = resolveActor(entry.actorType, entry.actorId);
  const workflowContext =
    entry.context ??
    (isWorkflowSentinel(entry.actorType, entry.actorId)
      ? inferWorkflowContextFromRuns(entry.createdAt, runs)
      : undefined);
  const preview = isPreviewableTaskActor(entry.actorType, entry.actorId)
    ? resolveActorPreview(entry.actorType, entry.actorId, {
        workflowSlug: workflowContext?.workflowSlug,
        wfExecutionId: workflowContext?.wfExecutionId,
      })
    : null;
  const displayName = isWorkflowSentinel(entry.actorType, entry.actorId)
    ? (preview?.name ?? t('timeline.unresolvedWorkflow'))
    : actor.name;
  // Each value reads as the field the action changed, never by what its text
  // spells: a title renamed from `todo` to `done` stays those words.
  const field = TASK_ACTIVITY_FIELD[entry.action];
  // An empty side is the `''` a cleared field stores, or the end a writer
  // leaves out for "nobody" and "does not repeat".
  const isEmptySide = (value: string | undefined) =>
    value === '' || (value === undefined && field?.absentIsEmpty === true);
  const emptyWords = () => {
    if (field?.kind === 'repeat') return repeatNever;
    return field?.emptyKey ? t(field.emptyKey) : undefined;
  };
  const historicalAgentIds = new Set(runs.map((run) => run.agentSlug));
  const formatActivityValue = (
    value: string | undefined,
  ): string | undefined => {
    // An empty side names the absence, so setting, changing and clearing
    // each read as the change they were.
    if (isEmptySide(value)) return emptyWords();
    // An end the row never recorded: nothing is invented for it.
    if (value === undefined) return undefined;
    switch (field?.kind) {
      case 'status':
        return isTaskStatus(value) ? t(`status.${value}`) : value;
      case 'priority': {
        const key = TASK_PRIORITY_LABEL_KEY[value];
        return key ? t(key) : value;
      }
      case 'person':
        return historicalAgentIds.has(value) &&
          resolveAssigneeId(value) === value
          ? t('timeline.deletedAgent')
          : resolveAssigneeId(value);
      case 'reviewer': {
        // Legacy rows stored a bare user id; new rows preserve actor kind.
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          return resolveAssigneeId(value);
        }
        const reviewer = taskReviewerSchema.safeParse(parsed);
        if (!reviewer.success) return value;
        if (reviewer.data.kind === 'inherit')
          return t('reviewer.projectDefaultLabel');
        return resolveActor(
          reviewer.data.kind,
          reviewer.data.kind === 'user'
            ? reviewer.data.userId
            : reviewer.data.agentId,
        ).name;
      }
      case 'reviewDecision': {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          return t('review.decisionUnavailable');
        }
        const receipt = taskAgentReviewReceiptSchema.safeParse(parsed);
        if (!receipt.success) return t('review.decisionUnavailable');
        return t(
          receipt.data.decision === 'approve'
            ? 'review.decisionApproved'
            : 'review.decisionChangesRequested',
        );
      }
      case 'date': {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return value;
        // A stored day no `Date` can hold reads as no date, as the board
        // reads it, never as the other side alone.
        return formatDate(new Date(parsed), 'short') || emptyWords();
      }
      case 'repeat': {
        // A rule keeps when it creates its next task, so a change of that
        // alone reads as one too.
        const rule = storedRepeatRule(value);
        return rule ? repeatLabel(rule) : undefined;
      }
      case 'refusal': {
        const key = TASK_RUN_REFUSAL_LABEL_KEY[value];
        return key ? t(key) : value;
      }
      default:
        // Titles, label and file names, task keys: as stored. A description
        // reads its mentions as `@` and today's names.
        return quoteActivityText(
          entry.action === 'description.changed'
            ? mentionPlainText(value, {
                kinds: MENTION_KINDS,
                nameOf: (ref) => mentions.byRef(ref)?.name,
              })
            : value,
        );
    }
  };
  // Empty on both sides (an assignee cleared that was already clear) names no
  // change, only that the row was written.
  const unchanged = isEmptySide(entry.fromValue) && isEmptySide(entry.toValue);
  const from = unchanged ? undefined : formatActivityValue(entry.fromValue);
  const to = unchanged ? undefined : formatActivityValue(entry.toValue);
  const detail = from && to ? `${from} → ${to}` : (to ?? from);

  // The change leads in its own words and casing (a German label is a noun
  // phrase), the person who made it follows.
  const Icon = activityIcon(entry.action, field?.kind);
  const statusGlyph =
    field?.kind === 'status' &&
    entry.toValue !== undefined &&
    isTaskStatus(entry.toValue) ? (
      <TaskStatusGlyph status={entry.toValue} className="size-3.5" />
    ) : undefined;

  return (
    <ThreadEvent
      className="[contain-intrinsic-block-size:auto_1.5rem] [content-visibility:auto]"
      {...(statusGlyph !== undefined ? { glyph: statusGlyph } : { icon: Icon })}
      time={<ThreadTime value={entry.createdAt} format={timeFormat} />}
    >
      <span>
        {label}
        {detail ? `: ${detail}` : ''}
      </span>
      <span aria-hidden="true"> · </span>
      <ThreadEventActor>
        <TaskActorName preview={preview} name={displayName} />
      </ThreadEventActor>
    </ThreadEvent>
  );
}
