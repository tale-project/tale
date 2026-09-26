'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Bot } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useTaskActivity, useTaskAgentRuns } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import {
  TASK_ACTIVITY_LABEL_KEY,
  TASK_PRIORITY_LABEL_KEY,
  TASK_RUN_REFUSAL_LABEL_KEY,
  isTaskStatus,
} from '../lib/display';
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

/**
 * One line of a task's history: an agent run (who, how it went, how long,
 * what it cost) or an activity entry (who changed what, from → to). Rendered
 * as a quiet single line, so it reads as the event it is between comments.
 */
export function TaskTimelineEntry({
  item,
  runs,
  organizationId,
  projectId,
}: {
  item: TimelineItem;
  runs: ReturnType<typeof useTaskAgentRuns>['runs'];
  organizationId: string;
  projectId: string;
}) {
  const { t } = useT('tasks');
  const {
    resolveActor,
    resolveAssigneeId,
    resolveActorPreview,
    resolveAgentRunPreview,
    resolveWorkflowRunPreview,
  } = useActorDirectory(organizationId, projectId);
  const { formatRelative, formatDate } = useFormatDate();

  if (item.kind === 'agentRun') {
    const { run } = item;
    const agentPreview = resolveAgentRunPreview(run);
    const workflowPreview = resolveWorkflowRunPreview(run);
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
  const formatActivityValue = (
    value: string | undefined,
  ): string | undefined => {
    if (value === undefined) return undefined;
    // `priority.changed` uses the empty string as the "no priority" sentinel;
    // map it before the generic empty-string pass-through below would
    // otherwise drop the cleared case.
    if (entry.action === 'priority.changed') {
      const key = TASK_PRIORITY_LABEL_KEY[value];
      return key ? t(key) : value;
    }
    if (!value) return undefined;
    if (entry.action === 'assignee.changed') {
      return resolveAssigneeId(value);
    }
    if (entry.action === 'reviewer.changed') {
      return resolveAssigneeId(value);
    }
    if (
      entry.action === 'startDate.changed' ||
      entry.action === 'dueDate.changed'
    ) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return formatDate(new Date(parsed), 'short');
      }
      return value;
    }
    if (isTaskStatus(value)) {
      return t(`status.${value}`);
    }
    if (
      entry.action === 'agent_run.refused' &&
      TASK_RUN_REFUSAL_LABEL_KEY[value]
    ) {
      return t(TASK_RUN_REFUSAL_LABEL_KEY[value]);
    }
    return value;
  };
  const from = formatActivityValue(entry.fromValue);
  const to = formatActivityValue(entry.toValue);
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

export function TaskTimeline({
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

  if (timeline.length === 0) return null;

  return (
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
          {timeline.map((item) => (
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
}
