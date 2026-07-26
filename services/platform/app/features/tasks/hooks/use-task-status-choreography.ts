'use client';

import { useCallback } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexClient } from '@/app/hooks/use-convex-client';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import {
  resolveTaskOwnership,
  useTaskContractAutomations,
  type TaskOwnershipFields,
} from './use-task-subject-contract';

/** The task fields status choreography reads. */
export interface ChoreographedTask extends TaskOwnershipFields {
  _id: Id<'tasks'>;
  projectId: Id<'projects'>;
  status: string;
  externalId?: string;
}

export type TaskTransitionPlan =
  | { kind: 'move' }
  | { kind: 'start' }
  | { kind: 'request_changes' }
  | { kind: 'cancel'; alsoMove: boolean }
  | { kind: 'block'; reason: 'missing_input' };

/**
 * Map a status change on an automation-owned task onto the owning workflow's
 * choreography — the board's NATIVE verbs stay the interface (drag to
 * In progress = start the run; drag it out = cancel; In review back to
 * In progress = request changes). Pure, so the whole matrix is unit-testable:
 *
 * - no contract / no-op move            → plain move
 * - leaving in_progress w/ active run   → cancel (+ plain move unless the
 *                                          target IS cancelled — cancel parks
 *                                          there itself)
 * - in_review → in_progress             → request changes (the run re-reads
 *                                          the timeline feedback)
 * - elsewhere → in_progress             → start when the contract's
 *                                          `start.when` holds; if it fails
 *                                          ONLY for missing input, block with
 *                                          feedback; otherwise plain move
 *                                          (e.g. reopening done → in_progress
 *                                          outside the start set)
 */
export function decideTaskStatusTransition(args: {
  contract: TaskSubjectContract | null;
  from: string;
  to: string;
  runActive: boolean;
  hasFiles: boolean;
}): TaskTransitionPlan {
  const { contract, from, to } = args;
  if (!contract || from === to) return { kind: 'move' };

  if (from === 'in_progress' && args.runActive) {
    return { kind: 'cancel', alsoMove: to !== 'cancelled' };
  }

  if (to !== 'in_progress') return { kind: 'move' };

  if (from === 'in_review') {
    return contract.review?.requestChanges === true
      ? { kind: 'request_changes' }
      : { kind: 'move' };
  }

  const when = contract.start?.when;
  if (when === undefined) return { kind: 'move' };
  if (evaluateWhen(when, { status: from, hasFiles: args.hasFiles })) {
    return { kind: 'start' };
  }
  // Would the gate pass with input present? Then input is the ONLY blocker —
  // surface that instead of silently moving a card the run will never pick up.
  if (evaluateWhen(when, { status: from, hasFiles: true })) {
    return { kind: 'block', reason: 'missing_input' };
  }
  return { kind: 'move' };
}

/**
 * The INTENT a status option would carry, for pre-flight hints in the status
 * picker — derived from the SAME matrix that executes the transition (with
 * `hasFiles` assumed present: the hint names the intent; the gate itself
 * still blocks at action time). `null` = a plain move, no hint.
 */
export function plannedTransitionKind(
  contract: TaskSubjectContract,
  from: string,
  to: string,
  runActive: boolean,
): 'start' | 'request_changes' | 'cancel' | null {
  const plan = decideTaskStatusTransition({
    contract,
    from,
    to,
    runActive,
    hasFiles: true,
  });
  return plan.kind === 'start' ||
    plan.kind === 'request_changes' ||
    plan.kind === 'cancel'
    ? plan.kind
    : null;
}

export type TaskTransitionOutcome = 'handled' | 'blocked' | 'move';

/**
 * The executor: resolve the owning contract, gather the live facts the plan
 * needs (active subject run; bound-folder files), run the plan's action, and
 * tell the caller whether it still owes the plain status write (`'move'`),
 * should revert its optimistic UI (`'blocked'`), or is done (`'handled'` —
 * the workflow's own ack step drives the status from here).
 */
export function useTaskStatusChoreography(
  organizationId: string,
  projectId: Id<'projects'> | undefined,
) {
  const automations = useTaskContractAutomations(organizationId, projectId);
  const client = useConvexClient();
  const startRun = useConvexAction(api.tasks.public_actions.startTaskWorkflow);
  const cancelRun = useConvexAction(
    api.tasks.public_actions.cancelTaskWorkflow,
  );
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  return useCallback(
    async (
      task: ChoreographedTask,
      to: string,
    ): Promise<TaskTransitionOutcome> => {
      // Only automation-owned tasks choreograph — agent- and human-owned
      // tasks keep their native verbs (the agent loop / a plain write).
      const ownership = resolveTaskOwnership(task, automations);
      if (ownership.kind !== 'automation') return 'move';
      const { contract } = ownership;

      // Facts, fetched only when the plan can depend on them.
      let runActive = false;
      if (task.status === 'in_progress') {
        const run = await client.query(
          api.automations.queries.getLiveRunForTask,
          {
            organizationId,
            projectId: task.projectId,
            taskId: task._id,
          },
        );
        runActive = run !== null;
      }
      let hasFiles = false;
      if (
        to === 'in_progress' &&
        task.status !== 'in_review' &&
        contract.input?.kind === 'folder' &&
        typeof task.externalId === 'string' &&
        task.externalId !== ''
      ) {
        const documents = await client.query(
          api.projects.queries.listProjectDocuments,
          { projectId: task.projectId, organizationId },
        );
        hasFiles = documents.some((doc) => doc.folderId === task.externalId);
      }

      const plan = decideTaskStatusTransition({
        contract,
        from: task.status,
        to,
        runActive,
        hasFiles,
      });

      switch (plan.kind) {
        case 'move':
          return 'move';
        case 'block':
          toast({ title: t('run.missingInput'), variant: 'destructive' });
          return 'blocked';
        case 'start':
        case 'request_changes':
          try {
            const result = await startRun.mutateAsync({
              organizationId,
              taskId: task._id,
              workflowSlug: ownership.automationSlug,
            });
            if (result.started) {
              toast({ title: t('run.started'), variant: 'success' });
              return 'handled';
            }
            toast({
              title:
                result.reason === 'already_running'
                  ? t('run.alreadyRunning')
                  : t('run.notStarted'),
              variant:
                result.reason === 'already_running' ? undefined : 'destructive',
            });
            return 'blocked';
          } catch (error) {
            console.error('[tasks] status-choreographed start failed', error);
            toast({ title: t('run.notStarted'), variant: 'destructive' });
            return 'blocked';
          }
        case 'cancel':
          try {
            await cancelRun.mutateAsync({ organizationId, taskId: task._id });
            toast({ title: t('run.cancelled') });
            return plan.alsoMove ? 'move' : 'handled';
          } catch (error) {
            console.error('[tasks] status-choreographed cancel failed', error);
            toast({ title: tCommon('errors.generic'), variant: 'destructive' });
            return 'blocked';
          }
      }
    },
    [automations, cancelRun, client, organizationId, startRun, t, tCommon],
  );
}
