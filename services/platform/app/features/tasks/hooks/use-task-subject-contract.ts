'use client';

import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import {
  parseTaskSubjectContract,
  type TaskSubjectContract,
} from '@/lib/shared/schemas/task_contract';

/** The task fields ownership resolution reads (a subset of the task doc). */
export interface TaskOwnershipFields {
  createdBy: string;
  createdByType: 'user' | 'agent' | 'app';
  externalSystem?: string;
  assigneeType?: 'user' | 'agent';
  assigneeId?: string;
}

export interface ResolvedTaskSubjectContract {
  /** The automation's store name — also the workflow the choreography runs. */
  automationSlug: string;
  contract: TaskSubjectContract;
}

/** One listed automation, as the contract surfaces need it. */
interface ContractAutomationEntry {
  name: string;
  deployedVersion?: number;
  taskContract?: unknown;
}

/**
 * The DEPLOYED automations visible from one project's task board: the
 * project's own plus the organization-level ones — a contract can operate
 * tasks from either surface.
 */
export function useTaskContractAutomations(
  organizationId: string,
  projectId: Id<'projects'> | undefined,
): ContractAutomationEntry[] {
  // '' means "not known yet" (empty board, modal still loading) — skip rather
  // than fire a member-gated query for no organization.
  const orgQuery = useConvexQuery(
    api.automations.queries.listAutomations,
    organizationId === '' ? 'skip' : { organizationId },
  );
  const projectQuery = useConvexQuery(
    api.automations.queries.listAutomations,
    organizationId === '' || projectId === undefined
      ? 'skip'
      : { organizationId, projectId },
  );
  return useMemo(
    () => [...(projectQuery.data ?? []), ...(orgQuery.data ?? [])],
    [orgQuery.data, projectQuery.data],
  );
}

/** Deployed automations narrowed to the ones carrying a VALID task contract
 *  (tolerant: an unparsable contract reads as none). */
export function taskSubjectEntries(
  automations: ContractAutomationEntry[],
): ResolvedTaskSubjectContract[] {
  return automations.flatMap((automation) => {
    if (automation.deployedVersion === undefined) return [];
    const contract = parseTaskSubjectContract(automation.taskContract);
    return contract === null
      ? []
      : [{ automationSlug: automation.name, contract }];
  });
}

/**
 * WHO this task belongs to. Every task resolves to exactly one of three
 * ownership classes, and the class decides which verbs its board moves carry:
 *
 * - `automation` — a deployed workflow's subject contract owns it; status
 *   changes route through that workflow (start / request changes / cancel).
 * - `agent` — an AI agent is the assignee; the task-agent loop drives it.
 * - `human` — everything else: a plain task, plain status writes.
 */
export type TaskOwnership =
  | ({ kind: 'automation' } & ResolvedTaskSubjectContract)
  | { kind: 'agent'; agentId: string }
  | { kind: 'human' };

/**
 * Classify a task into its ownership class. Arbitration order, strongest
 * claim first:
 *
 * 1. The write-once creation stamp (`createdByType: 'app'`, `createdBy:
 *    <automation name>`) — stamp-or-nothing: an app-created task whose
 *    automation is gone never falls through to another automation.
 * 2. An explicit agent assignee.
 * 3. A UNIQUE `externalSystem` match among the deployed contracts (tasks born
 *    before stamping) — ambiguity resolves to none; never guess an owner.
 *
 * Pure, so the rule is unit-testable.
 */
export function resolveTaskOwnership(
  task: TaskOwnershipFields,
  automations: ContractAutomationEntry[],
): TaskOwnership {
  const entries = taskSubjectEntries(automations);
  if (task.createdByType === 'app') {
    const stamped = entries.find(
      (entry) => entry.automationSlug === task.createdBy,
    );
    if (stamped) return { kind: 'automation', ...stamped };
  }
  if (task.assigneeType === 'agent' && task.assigneeId !== undefined) {
    return { kind: 'agent', agentId: task.assigneeId };
  }
  if (
    task.createdByType !== 'app' &&
    task.externalSystem !== undefined &&
    task.externalSystem !== ''
  ) {
    const matches = entries.filter(
      (entry) => entry.contract.externalSystem === task.externalSystem,
    );
    if (matches.length === 1 && matches[0] !== undefined) {
      return { kind: 'automation', ...matches[0] };
    }
  }
  return { kind: 'human' };
}

/** {@link resolveTaskOwnership} narrowed to the automation class — the owning
 * contract, or null for agent- and human-owned tasks. */
export function resolveTaskSubjectContract(
  task: TaskOwnershipFields,
  automations: ContractAutomationEntry[],
): ResolvedTaskSubjectContract | null {
  const ownership = resolveTaskOwnership(task, automations);
  return ownership.kind === 'automation'
    ? { automationSlug: ownership.automationSlug, contract: ownership.contract }
    : null;
}

/** {@link resolveTaskSubjectContract} over the surfaces visible from the
 * task's project. */
export function useTaskSubjectContract(
  organizationId: string,
  task:
    | (TaskOwnershipFields & { projectId: Id<'projects'> })
    | null
    | undefined,
): ResolvedTaskSubjectContract | null {
  const automations = useTaskContractAutomations(
    organizationId,
    task?.projectId,
  );
  return useMemo(
    () => (task ? resolveTaskSubjectContract(task, automations) : null),
    [automations, task],
  );
}

/** The contracts a user can CREATE tasks from on this board (template
 *  creation) — `create.enabled` contracts of deployed automations. */
export function useTaskSubjectTemplates(
  organizationId: string,
  projectId: Id<'projects'> | undefined,
): ResolvedTaskSubjectContract[] {
  const automations = useTaskContractAutomations(organizationId, projectId);
  return useMemo(
    () =>
      taskSubjectEntries(automations).filter(
        (entry) => entry.contract.create?.enabled === true,
      ),
    [automations],
  );
}
