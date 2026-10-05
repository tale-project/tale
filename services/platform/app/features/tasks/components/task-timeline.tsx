'use client';

import {
  taskAgentReviewReceiptSchema,
  taskReviewerSchema,
} from '@tale/shared/schemas/task-review';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { Bot } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { parseTaskRepeat, type TaskRepeat } from '@/lib/shared/task-repeat';

import { useTaskActivity, useTaskAgentRuns } from '../hooks/queries';
import {
  ActorDirectoryProvider,
  useActorDirectory,
  useProvidedActorDirectory,
  type ActorDirectory,
} from '../hooks/use-actor-directory';
import { useFirstFrameSlice } from '../hooks/use-first-frame-slice';
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
import { AssigneeAvatar } from './assignee-avatar';
import { TaskActorName } from './task-actor-preview-popover';
import { TaskAgentRunStatusBadge } from './task-agent-run-status-badge';

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type TimelineItem = ReturnType<typeof mergeTaskTimeline>[number];

/** How many history lines the opening frame renders; the rest follow in an
 *  interruptible background pass right after (see `TaskTimeline`). */
const FIRST_FRAME_LINES = 20;

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
 * total cost — what the Activity log and the task page's conversation read. */
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

interface TaskTimelineEntryProps {
  item: TimelineItem;
  runs: ReturnType<typeof useTaskAgentRuns>['runs'];
  organizationId: string;
  projectId: string;
}

/**
 * One line of a task's history: an agent run (who, how it went, how long,
 * what it cost) or an activity entry (who changed what, from → to). Rendered
 * as a quiet single line, so it reads as the event it is between comments.
 * Names come from the actor directory the timeline provides (a directory of
 * its own only outside one), and a line re-renders only when its props do.
 */
export const TaskTimelineEntry = memo(function TaskTimelineEntry(
  props: TaskTimelineEntryProps,
) {
  const provided = useProvidedActorDirectory(
    props.organizationId,
    props.projectId,
  );
  return provided !== undefined ? (
    <TimelineEntryRow {...props} directory={provided} />
  ) : (
    <TimelineEntryWithOwnDirectory {...props} />
  );
});

function TimelineEntryWithOwnDirectory(props: TaskTimelineEntryProps) {
  const directory = useActorDirectory(props.organizationId, props.projectId);
  return <TimelineEntryRow {...props} directory={directory} />;
}

function TimelineEntryRow({
  item,
  runs,
  directory: {
    resolveActor,
    resolveAssigneeId,
    resolveActorPreview,
    resolveAgentRunPreview,
    resolveWorkflowRunPreview,
  },
}: TaskTimelineEntryProps & { directory: ActorDirectory }) {
  const { t } = useT('tasks');
  const { formatRelative, formatDate } = useFormatDate();
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
      <div className="flex items-start gap-2 text-sm">
        <span
          className="bg-primary/10 text-primary mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full"
          aria-hidden
        >
          <Bot className="size-3" />
        </span>
        <div className="text-muted-foreground min-w-0 flex-1 text-xs">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Text
              as="span"
              variant="muted"
              className="text-foreground text-xs font-medium"
            >
              {t('timeline.runLabel')}
            </Text>
            <TaskActorName preview={agentPreview} name={agentPreview.name} />
            <TaskAgentRunStatusBadge run={run} agentName={agentPreview.name} />
            <span>
              {t(`agentRuns.trigger.${run.trigger}`)}
              {run.durationMs !== undefined
                ? ` · ${Math.round(run.durationMs / 1000)}s`
                : ''}
              {run.costCents > 0 ? ` · ${formatCents(run.costCents)}` : ''}
            </span>
            {workflowPreview ? (
              <>
                <span aria-hidden="true">·</span>
                <TaskActorName
                  preview={workflowPreview}
                  name={workflowPreview.name}
                />
              </>
            ) : null}
            {delegatorName !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('timeline.startedByAgent')}{' '}
                  <TaskActorName
                    preview={delegatorPreview}
                    name={delegatorName}
                  />
                </span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <time
              dateTime={new Date(run.startedAt).toISOString()}
              title={formatDate(new Date(run.startedAt), 'long')}
            >
              {formatRelative(new Date(run.startedAt))}
            </time>
          </div>
        </div>
      </div>
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
        return resolveAssigneeId(value);
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
        // Titles, descriptions, label and file names, task keys: as stored,
        // quoted to a line's length.
        return quoteActivityText(value);
    }
  };
  // Empty on both sides (an assignee cleared that was already clear) names no
  // change, only that the row was written.
  const unchanged = isEmptySide(entry.fromValue) && isEmptySide(entry.toValue);
  const from = unchanged ? undefined : formatActivityValue(entry.fromValue);
  const to = unchanged ? undefined : formatActivityValue(entry.toValue);
  const detail = from && to ? `${from} → ${to}` : (to ?? from);

  return (
    <div className="flex items-center gap-2">
      <AssigneeAvatar
        assigneeType={entry.actorType}
        assigneeId={entry.actorId}
        name={displayName}
      />
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
        <TaskActorName preview={preview} name={displayName} />
        <span>
          {label.toLowerCase()}
          {detail ? `: ${detail}` : ''}
        </span>
        <span aria-hidden="true">·</span>
        <time
          dateTime={new Date(entry.createdAt).toISOString()}
          title={formatDate(new Date(entry.createdAt), 'long')}
        >
          {formatRelative(new Date(entry.createdAt))}
        </time>
      </div>
    </div>
  );
}

export const TaskTimeline = memo(function TaskTimeline({
  taskId,
  organizationId,
  projectId,
}: {
  taskId: string;
  organizationId: string;
  projectId: string;
}) {
  const { t } = useT('tasks');
  const { timeline, runs, totalCostCents } = useTaskTimeline(taskId);
  const provided = useProvidedActorDirectory(organizationId, projectId);
  // The newest lines mount with the task, the older ones right after — a
  // long history sits below the comments, out of the opening screen.
  const shownTimeline = useFirstFrameSlice(timeline, FIRST_FRAME_LINES);

  if (timeline.length === 0) return null;

  const section = (
    <section>
      <Stack gap={2}>
        <div className="flex items-center justify-between gap-2">
          <Text as="h3" variant="label">
            {t('detail.activity')}
          </Text>
          {totalCostCents > 0 && (
            <Text as="span" variant="muted" className="text-xs tabular-nums">
              {t('agentRuns.totalCost', {
                amount: formatCents(totalCostCents),
              })}
            </Text>
          )}
        </div>
        <Stack as="ul" gap={3}>
          {shownTimeline.map((item) => (
            <li key={timelineItemKey(item)}>
              <TaskTimelineEntry
                item={item}
                runs={runs}
                organizationId={organizationId}
                projectId={projectId}
              />
            </li>
          ))}
        </Stack>
      </Stack>
    </section>
  );

  // Every line names its actor from one directory: the one the task's
  // surface provides, else one read here for the whole timeline.
  return provided !== undefined ? (
    section
  ) : (
    <ActorDirectoryProvider
      organizationId={organizationId}
      projectId={projectId}
    >
      {section}
    </ActorDirectoryProvider>
  );
});
