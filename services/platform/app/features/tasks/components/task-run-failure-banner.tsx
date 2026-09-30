'use client';

import { Alert } from '@tale/ui/alert';
import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useTaskActivity, useTaskAgentRuns } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { TASK_RUN_REFUSAL_LABEL_KEY } from '../lib/display';
import { mergeTaskTimeline } from '../utils/task-timeline';

/**
 * The run-admission refusal that is still the LATEST thing that happened to
 * the task (the top of the merged activity + run timeline), or null. A later
 * reassignment, a successful run, or any other activity clears it — no
 * separate dismiss/ack state to persist.
 *
 * Read by the task dialog too: a refused automatic retry leaves a failed run
 * behind it, and the refusal is the newer and more precise account of why
 * nothing is working on the task, so the failed-run notice
 * (`TaskAgentRunFailureNotice`) steps aside while this banner speaks.
 */
export function useLatestRunRefusal(taskId: string) {
  const { activity } = useTaskActivity(taskId);
  const { runs } = useTaskAgentRuns(taskId);
  const latest = mergeTaskTimeline(activity, runs)[0];
  return latest?.kind === 'activity' &&
    latest.entry.action === 'agent_run.refused'
    ? latest.entry
    : null;
}

/**
 * Primary, can't-miss failure state for a run-admission refusal (#2609) — a
 * refused run never touches the task status (#2604) and never creates a
 * `taskAgentRuns` row, so without this banner the only trace is an automated
 * comment and an activity row buried below the fold. Shown while the
 * refusal is the latest thing that happened to the task
 * ({@link useLatestRunRefusal}).
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
  const entry = useLatestRunRefusal(taskId);
  const { resolveActor } = useActorDirectory(organizationId, projectId);

  if (entry === null) return null;

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
