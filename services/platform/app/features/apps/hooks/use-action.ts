'use client';

/**
 * The action-dispatch registry — the "do" half of the configurable app surface,
 * sibling to use-data-source (the "what"). Maps a closed `action.kind` to ONE
 * existing, audited platform mutation, auto-injecting the selected item's
 * context (approvalId/taskId/workflow/threadId). The app never names a mutation;
 * the host owns dispatch (the Forge/Slack routing model). Every write lands on
 * the deterministic spine bound to the authenticated org member — the app
 * surface is a fast control panel, never a second write path.
 */
import { useCallback } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { isActionKind } from '@/lib/shared/platform/action_kinds';
import type { ViewAction } from '@/lib/shared/schemas/views';

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

export interface AppActions {
  dispatch: (
    action: ViewAction,
    item: Record<string, unknown>,
  ) => Promise<void>;
  isPending: boolean;
}

export function useAppActions(organizationId: string): AppActions {
  const respondReview = useConvexMutation(
    api.tasks.review_mutations.respondToTaskReview,
  );
  const assign = useConvexMutation(api.tasks.mutations.assignTask);
  const comment = useConvexMutation(api.tasks.mutations.addTaskComment);
  const enqueue = useConvexMutation(api.threads.message_queue.enqueueMessage);
  const startWorkflow = useConvexAction(
    api.workflow_executions.actions.startWorkflowFromFile,
  );

  const dispatch = useCallback(
    async (action: ViewAction, item: Record<string, unknown>) => {
      const kind = action.kind;
      if (!isActionKind(kind)) throw new Error(`unknown action "${kind}"`);
      const params = action.params ?? {};
      const feedback =
        typeof params.feedback === 'string' ? params.feedback : undefined;

      // Each verb validates its required item context + params BEFORE calling
      // the mutation — a missing field throws a clear client error rather than
      // sending an empty-string Id / a half-set assignee pair that the platform
      // mutation would reject with a confusing message. The app surface never
      // dispatches an under-specified write.
      switch (kind) {
        case 'approve':
        case 'respond': {
          const approvalId = str(item, 'id');
          if (!approvalId) throw new Error(`${kind}: item has no approval id`);
          await respondReview.mutateAsync({
            approvalId: toId<'approvals'>(approvalId),
            decision: 'approve',
            ...(feedback !== undefined && { feedback }),
          });
          return;
        }
        case 'reject': {
          const approvalId = str(item, 'id');
          if (!approvalId) throw new Error('reject: item has no approval id');
          await respondReview.mutateAsync({
            approvalId: toId<'approvals'>(approvalId),
            decision: 'request_changes',
            feedback: feedback ?? 'Changes requested',
          });
          return;
        }
        case 'trigger_workflow': {
          const workflowSlug =
            typeof params.workflow === 'string' ? params.workflow : '';
          if (!workflowSlug)
            throw new Error('trigger_workflow: missing workflow');
          await startWorkflow.mutateAsync({
            organizationId,
            workflowSlug,
            triggeredBy: 'user',
            input: { task: item },
          });
          return;
        }
        case 'assign': {
          const taskId = str(item, 'taskId');
          const assigneeId =
            typeof params.assigneeId === 'string' ? params.assigneeId : '';
          if (!taskId) throw new Error('assign: item has no taskId');
          // assigneeId is an agent SLUG (the platform's polymorphic-assignee
          // convention). Never send a half-set { type, id:'' } pair — the
          // mutation rejects it; require a concrete assignee instead.
          if (!assigneeId) throw new Error('assign: missing assigneeId');
          await assign.mutateAsync({
            taskId: toId<'tasks'>(taskId),
            assigneeType: 'agent',
            assigneeId,
          });
          return;
        }
        case 'comment': {
          const taskId = str(item, 'taskId');
          const body = typeof params.text === 'string' ? params.text : '';
          if (!taskId) throw new Error('comment: item has no taskId');
          if (!body) throw new Error('comment: missing text');
          await comment.mutateAsync({ taskId: toId<'tasks'>(taskId), body });
          return;
        }
        case 'steer': {
          const threadId = str(item, 'threadId');
          const agentSlug = str(item, 'agentSlug');
          const message =
            typeof params.message === 'string' ? params.message : '';
          // Only bindable to a source that exposes a live thread + agent.
          if (!threadId || !agentSlug) {
            throw new Error('steer: item has no live thread/agent to steer');
          }
          if (!message) throw new Error('steer: missing message');
          await enqueue.mutateAsync({
            threadId,
            organizationId,
            message,
            agentSlug,
          });
          return;
        }
      }
    },
    [organizationId, respondReview, assign, comment, enqueue, startWorkflow],
  );

  const isPending =
    respondReview.isPending ||
    assign.isPending ||
    comment.isPending ||
    enqueue.isPending ||
    startWorkflow.isPending;

  return { dispatch, isPending };
}
