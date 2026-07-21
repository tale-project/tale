'use client';

import { useMemo } from 'react';

import {
  useAutomations,
  type AutomationSummary,
} from '@/app/features/automations/hooks/use-automations';
import {
  taskSubjectContractSchema,
  type TaskSubjectContract,
} from '@/lib/shared/schemas/automations';

/** The task fields ownership resolution reads (a subset of the task doc). */
export interface TaskOwnershipFields {
  createdBy: string;
  createdByType: 'user' | 'agent' | 'app';
  externalSystem?: string;
}

export interface ResolvedTaskSubjectContract {
  automationSlug: string;
  contract: TaskSubjectContract;
  /** Display fields of the owning automation (template picker labels). */
  name: string;
  i18n?: AutomationSummary['i18n'];
}

/** Installed automations narrowed to the ones declaring a VALID task
 *  contract (tolerant: an unparsable contract reads as none). */
export function taskSubjectEntries(
  automations: AutomationSummary[],
): ResolvedTaskSubjectContract[] {
  return automations.flatMap((a) => {
    const parsed = taskSubjectContractSchema.safeParse(a.subjects?.task);
    return parsed.success
      ? [
          {
            automationSlug: a.slug,
            contract: parsed.data,
            name: a.name,
            i18n: a.i18n,
          },
        ]
      : [];
  });
}

/**
 * Which automation OWNS this task, and under what contract. Ownership is the
 * write-once creation stamp (`createdByType: 'app'`, `createdBy: <slug>`);
 * tasks born before stamping fall back to a UNIQUE `externalSystem` match
 * among the installed contracts — ambiguity resolves to none (never guess
 * an owner). Pure, so the rule is unit-testable.
 */
export function resolveTaskSubjectContract(
  task: TaskOwnershipFields,
  automations: AutomationSummary[],
): ResolvedTaskSubjectContract | null {
  const entries = taskSubjectEntries(automations);
  if (task.createdByType === 'app') {
    return entries.find((e) => e.automationSlug === task.createdBy) ?? null;
  }
  if (task.externalSystem) {
    const matches = entries.filter(
      (e) => e.contract.externalSystem === task.externalSystem,
    );
    if (matches.length === 1) return matches[0];
  }
  return null;
}

/** {@link resolveTaskSubjectContract} over the org's installed automations. */
export function useTaskSubjectContract(
  organizationId: string,
  task: TaskOwnershipFields | null | undefined,
): ResolvedTaskSubjectContract | null {
  const { automations } = useAutomations(organizationId);
  return useMemo(
    () => (task ? resolveTaskSubjectContract(task, automations) : null),
    [automations, task],
  );
}

/** The contracts a user can CREATE tasks from on this board (template
 *  creation) — `create.enabled` contracts of installed automations. */
export function useTaskSubjectTemplates(
  organizationId: string,
): ResolvedTaskSubjectContract[] {
  const { automations } = useAutomations(organizationId);
  return useMemo(
    () =>
      taskSubjectEntries(automations).filter(
        (e) => e.contract.create?.enabled === true,
      ),
    [automations],
  );
}
