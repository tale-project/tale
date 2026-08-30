'use client';

import { Alert } from '@tale/ui/alert';
import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useTaskActivity, useTaskAgentRuns } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { TASK_RUN_REFUSAL_LABEL_KEY } from '../lib/display';
import { mergeTaskTimeline } from '../utils/task-timeline';

/**
 * Primary, can't-miss failure state for a run-admission refusal (#2609) — a
 * refused run never touches the task status (#2604) and never creates a
 * `taskAgentRuns` row, so without this banner the only trace is an automated
 * comment and an activity row buried below the fold.
 *
 * Shows only while the refusal is still the LATEST thing that happened to the
 * task (the top of the merged activity + run timeline): a later reassignment,
 * a successful run, or any other activity naturally clears it — no separate
 * dismiss/ack state to persist.
 */
export function TaskRunFailureBanner({
  taskId,
  organizationId,
  projectId,
}: {
  taskId: string;
  organizationId: string;
  projectId?: string;
}) {
  const { t } = useT('tasks');
  const { activity } = useTaskActivity(taskId);
  const { runs } = useTaskAgentRuns(taskId);
  const { resolveActor } = useActorDirectory(organizationId, projectId);

  const latest = mergeTaskTimeline(activity, runs)[0];
  if (
    !latest ||
    latest.kind !== 'activity' ||
    latest.entry.action !== 'agent_run.refused'
  ) {
    return null;
  }

  const { entry } = latest;
  const actor = resolveActor(entry.actorType, entry.actorId);
  const reasonKey = entry.toValue
    ? TASK_RUN_REFUSAL_LABEL_KEY[entry.toValue]
    : undefined;
  const reason = reasonKey ? t(reasonKey) : (entry.toValue ?? entry.action);

  return (
    <Alert
      variant="warning"
      icon={AlertTriangle}
      title={t('runFailure.title')}
      description={
        <p>{t('runFailure.description', { agent: actor.name, reason })}</p>
      }
    />
  );
}
