'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { RotateCw } from 'lucide-react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import { taskRunFailureClass } from '@/lib/shared/task-run-failure';

import { useTaskAgentRunControls } from '../hooks/use-task-agent-run-controls';

/**
 * The agent gave up on this task — said in the task's body, where it cannot
 * be missed. A failed run keeps the task at In progress (failure is the
 * run's state, not the task's), so without this the only sign was a red dot
 * and a clamped line of the harness's own English in the narrow details
 * panel, which a phone folds away: the card looked like work in progress
 * with nothing working on it.
 *
 * Leads with what the failure means for the reader (the run's failure class,
 * `lib/shared/task-run-failure.ts`); the raw reason stays behind Details on
 * the run strip. Shown only for a failure that is final — a run the platform
 * is about to retry by itself asks nothing of anyone — and only while the
 * task still waits on that agent: the caller mounts it for an agent-assigned
 * task at In progress.
 */
export function TaskAgentRunFailureNotice({
  organizationId,
  taskId,
  assigneeId,
  canRetry,
}: {
  organizationId: string;
  taskId: string;
  /** The agent the task is assigned to. */
  assigneeId: string;
  /** The viewer may start the agent again (the task's work gate, with an
   * agent that still exists). */
  canRetry: boolean;
}) {
  const { t } = useT('tasks');
  // Same read as the run strip beside the assignee: one request serves both.
  const { data: run } = useBackendQuery(
    'tasks/queries:getLatestTaskAgentRunForTask',
    { organizationId, taskId },
  );
  const { start, busy } = useTaskAgentRunControls(taskId);

  if (
    run == null ||
    run.status !== 'failed' ||
    run.retryPending === true ||
    run.agentId !== assigneeId
  ) {
    return null;
  }

  return (
    <Alert
      variant="warning"
      title={t('agentRun.failureTitle')}
      description={
        <p>{t(`agentRun.failure.${taskRunFailureClass(run.failureCode)}`)}</p>
      }
    >
      {canRetry && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          icon={RotateCw}
          isLoading={busy}
          onClick={() => void start()}
        >
          {t('agentRun.retry')}
        </Button>
      )}
    </Alert>
  );
}
