'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useCallback } from 'react';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendClient } from '@/app/hooks/use-backend-client';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import { useCancelTaskAgentRun, useStartTaskAgentRun } from './mutations';
import {
  resolveTaskOwnership,
  useTaskContractAutomations,
  type TaskOwnershipFields,
} from './use-task-subject-contract';

/** The task fields status choreography reads. */
export interface ChoreographedTask extends TaskOwnershipFields {
  _id: string;
  projectId: string;
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

export interface TaskStatusChoreographyOptions {
  /** Asked before a live run is cancelled by a status move (drag out of
   * In progress, or the picker's cancel verb). Resolve false to keep the
   * run — the transition then reports `'blocked'` and the caller reverts
   * its optimistic UI. Absent ⇒ cancel without asking (legacy behavior). */
  confirmCancel?: () => Promise<boolean>;
}

/**
 * The executor: resolve the owning contract, gather the live facts the plan
 * needs (active subject run; bound-folder files), run the plan's action, and
 * tell the caller whether it still owes the plain status write (`'move'`),
 * should revert its optimistic UI (`'blocked'`), or is done (`'handled'` —
 * the workflow's own ack step drives the status from here).
 */
export function useTaskStatusChoreography(
  organizationId: string,
  projectId: string | undefined,
  options?: TaskStatusChoreographyOptions,
) {
  const automations = useTaskContractAutomations(organizationId, projectId);
  const client = useBackendClient();
  const startRun = useBackendAction('tasks/public_actions:startTaskWorkflow', {
    errorToast: false,
  });
  const cancelRun = useBackendAction(
    'tasks/public_actions:cancelTaskWorkflow',
    {
      errorToast: false,
    },
  );
  const { mutateAsync: startAgentRun } = useStartTaskAgentRun();
  const { mutateAsync: cancelAgentRun } = useCancelTaskAgentRun();
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();

  const confirmCancel = options?.confirmCancel;

  return useCallback(
    async (
      task: ChoreographedTask,
      to: string,
    ): Promise<TaskTransitionOutcome> => {
      const ownership = resolveTaskOwnership(task, automations, locale);

      // Agent-owned: the board verbs drive the task-agent run loop. Dragging
      // to In progress (from anywhere — including In review, which IS
      // "request changes") kicks a run; leaving In progress cancels a live
      // one first, then the plain move still happens.
      if (ownership.kind === 'agent') {
        if (to === 'in_progress') {
          try {
            const result = await startAgentRun({ taskId: task._id });
            if (result.started) {
              toast({ title: t('agentRun.started'), variant: 'success' });
              return 'handled';
            }
            if (result.reason === 'already_running') {
              toast({ title: t('agentRun.alreadyRunning') });
              return 'handled';
            }
            toast({ title: t('agentRun.notStarted'), variant: 'destructive' });
            return 'blocked';
          } catch (error) {
            console.error('[tasks] agent-run start failed', error);
            toast({ title: t('agentRun.notStarted'), variant: 'destructive' });
            return 'blocked';
          }
        }
        if (task.status === 'in_progress') {
          // Only a LIVE run warrants the confirm (and the cancel call) — a
          // settled/failed run costs nothing to move away from.
          const latest = await client.query(
            'tasks/queries:getLatestTaskAgentRunForTask',
            { organizationId, taskId: task._id },
          );
          const live =
            latest !== null &&
            (latest.status === 'queued' || latest.status === 'running');
          if (live) {
            if (confirmCancel && !(await confirmCancel())) {
              return 'blocked';
            }
            try {
              await cancelAgentRun({ taskId: task._id });
            } catch (error) {
              // The move still proceeds — a stuck run is cut by its deadline.
              console.warn('[tasks] agent-run cancel failed', error);
            }
          }
        }
        return 'move';
      }

      // Human-owned tasks keep their native verbs (a plain write).
      if (ownership.kind !== 'automation') return 'move';
      const { contract } = ownership;

      // Facts, fetched only when the plan can depend on them.
      let runActive = false;
      if (task.status === 'in_progress') {
        const run = await client.query(
          'automations/queries:getLiveRunForTask',
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
        // The server-stamped subtree fact — the same predicate staging uses
        // (`getTask` shares it with the board chip), so the drag gate cannot
        // disagree with what the run would actually mount. A root-only
        // client probe here once blocked nested-only deliveries.
        const detail = await client.query('tasks/queries:getTask', {
          taskId: task._id,
          organizationId,
        });
        hasFiles = detail?.task.hasFiles === true;
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
              toast({
                title: t('run.started', { name: ownership.displayName }),
                variant: 'success',
              });
              return 'handled';
            }
            toast({
              title:
                result.reason === 'already_running'
                  ? t('run.alreadyRunning', { name: ownership.displayName })
                  : t('run.notStarted', { name: ownership.displayName }),
              variant:
                result.reason === 'already_running' ? undefined : 'destructive',
            });
            return 'blocked';
          } catch (error) {
            console.error('[tasks] status-choreographed start failed', error);
            toast({
              title: t('run.notStarted', { name: ownership.displayName }),
              variant: 'destructive',
            });
            return 'blocked';
          }
        case 'cancel':
          if (confirmCancel && !(await confirmCancel())) {
            return 'blocked';
          }
          try {
            await cancelRun.mutateAsync({ organizationId, taskId: task._id });
            toast({ title: t('run.cancelled') });
            return plan.alsoMove ? 'move' : 'handled';
          } catch (error) {
            console.error('[tasks] status-choreographed cancel failed', error);
            toast({ title: tCommon('errors.generic'), variant: 'destructive' });
            return 'blocked';
          }
        default: {
          const exhaustive: never = plan;
          return exhaustive;
        }
      }
    },
    [
      automations,
      cancelAgentRun,
      cancelRun,
      client,
      confirmCancel,
      locale,
      organizationId,
      startAgentRun,
      startRun,
      t,
      tCommon,
    ],
  );
}
