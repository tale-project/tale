'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bot } from 'lucide-react';
import { useMemo } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useTaskActivity, useTaskAgentRuns } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import {
  TASK_ACTIVITY_LABEL_KEY,
  TASK_RUN_REFUSAL_LABEL_KEY,
  isTaskStatus,
  type TaskCreatorType,
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

export function TaskTimeline({
  taskId,
  organizationId,
  projectId,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  projectId: Id<'projects'>;
}) {
  const { t } = useT('tasks');
  const { activity } = useTaskActivity(taskId);
  const { runs } = useTaskAgentRuns(taskId);
  const {
    resolveActor,
    resolveActorPreview,
    resolveAgentRunPreview,
    resolveWorkflowRunPreview,
  } = useActorDirectory(organizationId, projectId);
  const { formatRelative, formatDate } = useFormatDate();

  const timeline = useMemo(
    () => mergeTaskTimeline(activity, runs),
    [activity, runs],
  );

  const totalCostCents = useMemo(
    () => runs.reduce((sum, run) => sum + run.costCents, 0),
    [runs],
  );

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
          {timeline.map((item) => {
            if (item.kind === 'agentRun') {
              const { run } = item;
              const agentPreview = resolveAgentRunPreview(run);
              const workflowPreview = resolveWorkflowRunPreview(run);
              return (
                <li
                  key={`run-${run.runId}`}
                  className="flex items-start gap-2 text-sm"
                >
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
                      <TaskActorName
                        preview={agentPreview}
                        name={agentPreview.name}
                      />
                      <TaskAgentRunStatusBadge
                        run={run}
                        agentName={agentPreview.name}
                      />
                      <span>
                        {t(`agentRuns.trigger.${run.trigger}`)}
                        {run.durationMs !== undefined
                          ? ` · ${Math.round(run.durationMs / 1000)}s`
                          : ''}
                        {run.costCents > 0
                          ? ` · ${formatCents(run.costCents)}`
                          : ''}
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
                </li>
              );
            }

            const { entry } = item;
            const labelKey = TASK_ACTIVITY_LABEL_KEY[entry.action];
            const label = labelKey ? t(labelKey) : entry.action;
            const actor = resolveActor(
              entry.actorType as TaskCreatorType,
              entry.actorId,
            );
            const workflowContext =
              entry.context ??
              (isWorkflowSentinel(entry.actorType, entry.actorId)
                ? inferWorkflowContextFromRuns(entry.createdAt, runs)
                : undefined);
            const preview = isPreviewableTaskActor(
              entry.actorType,
              entry.actorId,
            )
              ? resolveActorPreview(entry.actorType, entry.actorId, {
                  workflowSlug: workflowContext?.workflowSlug,
                  wfExecutionId: workflowContext?.wfExecutionId,
                })
              : null;
            const displayName = isWorkflowSentinel(
              entry.actorType,
              entry.actorId,
            )
              ? (preview?.name ?? t('timeline.unresolvedWorkflow'))
              : actor.name;
            const from =
              entry.fromValue && isTaskStatus(entry.fromValue)
                ? t(`status.${entry.fromValue}`)
                : entry.fromValue;
            const refusalLabelKey =
              entry.action === 'agent_run.refused' && entry.toValue
                ? TASK_RUN_REFUSAL_LABEL_KEY[entry.toValue]
                : undefined;
            const to =
              entry.toValue && isTaskStatus(entry.toValue)
                ? t(`status.${entry.toValue}`)
                : refusalLabelKey
                  ? t(refusalLabelKey)
                  : entry.toValue;
            const detail = from && to ? `${from} → ${to}` : (to ?? from);

            return (
              <li key={entry._id} className="flex items-center gap-2">
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
              </li>
            );
          })}
        </Stack>
      </Stack>
    </section>
  );
}
