'use client';

import {
  taskReviewerFromIds,
  type SetTaskReviewerInput,
} from '@tale/shared/schemas/task-review';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { useRef } from 'react';

import { useProjectAgents } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useSetTaskReviewer } from '../hooks/mutations';
import { useActorDirectory } from '../hooks/use-actor-directory';
import type { TaskDoc } from '../lib/display';
import {
  reviewerBlockedMessage,
  reviewerRefusalMessage,
} from '../lib/reviewer-refusal';
import { ReviewerPicker } from './reviewer-picker';

/** The task-specific read keeps the pending review identity and its configured
 * successor together. A stale picker cannot redirect another result. */
export function TaskReviewerField({
  task,
  canEdit,
}: {
  task: Pick<
    TaskDoc,
    | '_id'
    | 'organizationId'
    | 'projectId'
    | 'assigneeType'
    | 'assigneeId'
    | 'reviewerUserId'
    | 'reviewerAgentId'
  >;
  canEdit: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const query = useBackendQuery('tasks/queries:getTaskReviewer', {
    organizationId: task.organizationId,
    taskId: task._id,
  });
  const mutation = useSetTaskReviewer();
  const selection = useRef<{
    taskId: string;
    expected: SetTaskReviewerInput['expected'];
  } | null>(null);
  const { resolveActor } = useActorDirectory(
    task.organizationId,
    task.projectId,
  );
  const { agents, isLoading: agentsLoading } = useProjectAgents(
    asProjectId(task.projectId),
  );
  const state = query.data;
  const pending = state?.pendingReview;
  const recipient = pending?.reviewer;
  const pendingName = recipient
    ? resolveActor(
        recipient.kind,
        recipient.kind === 'user' ? recipient.userId : recipient.agentId,
      ).name
    : t('reviewer.none');
  const configuredAgentId =
    state?.reviewer.kind === 'agent'
      ? state.reviewer.agentId
      : state?.reviewer.kind === 'inherit' &&
          state.projectReviewer.kind === 'agent'
        ? state.projectReviewer.agentId
        : undefined;
  const agentId =
    recipient?.kind === 'agent' ? recipient.agentId : configuredAgentId;
  const agent = agents.find((candidate) => candidate._id === agentId);
  const unavailable = agentId !== undefined && !agentsLoading && !agent;
  const missingPermission =
    agent !== undefined && !agent.tools?.includes('task_review');
  const blockedMessage = reviewerBlockedMessage(
    pending?.agentReviewBlockedReason ?? null,
    t,
  );

  return (
    <Stack gap={2}>
      {(state || !query.isError) && (
        <Skeletonize loading={!state && !query.isError}>
          <SkeletonBox asChild>
            <span>
              <ReviewerPicker
                organizationId={task.organizationId}
                projectId={task.projectId}
                reviewer={state?.reviewer ?? taskReviewerFromIds(task)}
                projectReviewer={
                  state?.projectReviewer ?? { kind: 'human_default' }
                }
                implementationAgentId={
                  pending
                    ? (pending.implementationAgentId ?? undefined)
                    : task.assigneeType === 'agent'
                      ? task.assigneeId
                      : undefined
                }
                disabled={!state || !canEdit || query.isError}
                busy={mutation.isPending}
                align="end"
                onOpenChange={(open) => {
                  if (!open || !state) return;
                  selection.current = {
                    taskId: task._id,
                    expected: {
                      reviewer: state.reviewer,
                      pendingReview: pending
                        ? {
                            approvalId: pending.approvalId,
                            runId: pending.runId,
                            reviewer: pending.reviewer,
                          }
                        : null,
                    },
                  };
                }}
                onChange={(reviewer) => {
                  const observed = selection.current;
                  if (!state || observed?.taskId !== task._id) return;
                  void mutation
                    .mutateAsync({
                      taskId: task._id,
                      reviewer,
                      expected: observed.expected,
                    })
                    .catch((error: unknown) => {
                      const refusal = reviewerRefusalMessage(error, t);
                      toast({
                        title: refusal ?? t('reviewer.saveError'),
                        ...(refusal === undefined
                          ? { description: failureDetail(error) }
                          : {}),
                        variant: 'destructive',
                      });
                      void query.refetch();
                    });
                }}
              />
            </span>
          </SkeletonBox>
        </Skeletonize>
      )}
      {pending && (
        <Text variant="caption">
          {t('reviewer.pendingFor', { reviewer: pendingName })}
        </Text>
      )}
      {pending && canEdit && (
        <Text variant="caption">{t('reviewer.transferHint')}</Text>
      )}
      {blockedMessage && (
        <Text variant="caption" role="status">
          {blockedMessage}
        </Text>
      )}
      {!pending && unavailable && (
        <Text variant="caption">{t('reviewer.agentUnavailable')}</Text>
      )}
      {!pending && missingPermission && (
        <Text variant="caption">{t('reviewer.agentPermissionRequired')}</Text>
      )}
      {query.isError && (
        <div role="status">
          <Text variant="caption">{t('reviewer.loadError')}</Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            {tCommon('actions.tryAgain')}
          </Button>
        </div>
      )}
    </Stack>
  );
}
