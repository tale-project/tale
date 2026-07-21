'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';

import { useProjectDocuments } from '@/app/features/projects/hooks/queries';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isActiveExecutionStatus } from '@/lib/shared/platform/run_capacity';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';

import { useTaskSubjectContract } from '../hooks/use-task-subject-contract';

/**
 * The task modal's run actions — the SAME verbs the owning automation's desk
 * view offers, driven by its `subjects.task` contract instead of view config:
 * Start gated by `start.when` over {status, hasFiles}, Request changes at
 * `in_review` (comment first in the thread below — the run reads the timeline),
 * Cancel while a run is active. Renders nothing for tasks no automation owns,
 * so ordinary board tasks are untouched.
 */
export function TaskRunActions({
  organizationId,
  task,
}: {
  organizationId: string;
  task: {
    _id: Id<'tasks'>;
    projectId: Id<'projects'>;
    status: string;
    createdBy: string;
    createdByType: 'user' | 'agent' | 'app';
    externalSystem?: string;
    externalId?: string;
  };
}) {
  const { t } = useT('tasks');
  const { t: tAutomations } = useT('automations');
  const resolved = useTaskSubjectContract(organizationId, task);

  const { data: run } = useConvexQuery(
    api.workflow_executions.queries.getLatestExecutionForSubject,
    { organizationId, subjectType: 'task', subjectId: task._id },
  );
  // Same reactive source the folder card lists — a fresh upload flips the
  // Start gate without a reload.
  const { documents } = useProjectDocuments(task.projectId);

  const startRun = useConvexAction(api.tasks.public_actions.startTaskWorkflow);
  const cancelRun = useConvexAction(
    api.tasks.public_actions.cancelTaskWorkflow,
  );

  if (!resolved) return null;
  const { contract } = resolved;

  const runActive = run != null && isActiveExecutionStatus(run.status);
  const hasFiles =
    contract.input?.kind === 'folder' &&
    task.externalId !== undefined &&
    documents.some((doc) => doc.folderId === task.externalId);

  const startWhen = contract.start?.when;
  const canStart =
    !runActive &&
    startWhen !== undefined &&
    evaluateWhen(startWhen, { status: task.status, hasFiles });
  const canRequestChanges =
    !runActive &&
    contract.review?.requestChanges === true &&
    task.status === 'in_review';
  const pending = startRun.isPending || cancelRun.isPending;

  if (!canStart && !canRequestChanges && !runActive) return null;

  const start = async () => {
    try {
      const result = await startRun.mutateAsync({
        organizationId,
        taskId: task._id,
        workflowSlug: contract.workflow,
      });
      if (result.started) {
        toast({ title: t('run.started'), variant: 'success' });
      } else if (result.reason === 'already_running') {
        toast({ title: t('run.alreadyRunning') });
      } else {
        toast({ title: t('run.notStarted'), variant: 'destructive' });
      }
    } catch (error) {
      console.error('[tasks] start run failed', error);
      toast({ title: t('run.notStarted'), variant: 'destructive' });
    }
  };

  const cancel = async () => {
    try {
      await cancelRun.mutateAsync({ organizationId, taskId: task._id });
      toast({ title: t('run.cancelled') });
    } catch (error) {
      console.error('[tasks] cancel run failed', error);
      toast({ title: t('run.notStarted'), variant: 'destructive' });
    }
  };

  return (
    <Row gap={2} justify="end">
      {canStart && (
        <Button disabled={pending} onClick={() => void start()}>
          {tAutomations('list.start')}
        </Button>
      )}
      {canRequestChanges && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => void start()}
        >
          {tAutomations('list.requestChanges')}
        </Button>
      )}
      {runActive && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => void cancel()}
        >
          {tAutomations('list.cancel')}
        </Button>
      )}
    </Row>
  );
}
