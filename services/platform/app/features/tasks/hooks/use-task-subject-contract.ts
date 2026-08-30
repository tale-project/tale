'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import {
  automationDisplayDescription,
  automationDisplayName,
} from '@/lib/shared/schemas/automation_presentation';
import {
  type AutomationSettings,
  parseAutomationSettings,
} from '@/lib/shared/schemas/automation_settings';
import {
  parseTaskSubjectContract,
  type TaskSubjectContract,
} from '@/lib/shared/schemas/task_contract';

/** The task fields ownership resolution reads (a subset of the task doc). */
export interface TaskOwnershipFields {
  createdBy: string;
  createdByType: 'user' | 'agent' | 'app';
  externalSystem?: string;
  assigneeType?: 'user' | 'agent' | 'app';
  assigneeId?: string;
}

export interface ResolvedTaskSubjectContract {
  /** The automation's store name — also the workflow the choreography runs.
   * ADDRESSING, not a label: show `displayName` to people. */
  automationSlug: string;
  /** What the automation calls itself in the reader's language (the pack
   * manifest's `name`/`i18n`), or the slug read as a title when it declared
   * none. Every user-visible mention of the automation uses this. */
  displayName: string;
  /**
   * How the automation describes ITSELF in the reader's language (the pack
   * manifest's `description`/`i18n`), when it declared one.
   *
   * This is what a task surface shows to answer "what is this thing" — it
   * belongs to the automation, so it stays live, versioned with the deployed
   * document and translated once, rather than being copied into each task's
   * own editable description.
   */
  displayDescription?: string;
  contract: TaskSubjectContract;
  /** The deployed version's settings declaration (tolerant: unparsable reads
   * as none) — the create-template setup gate and the Settings entry. */
  settings: AutomationSettings | null;
}

/** One listed automation, as the contract surfaces need it. */
interface ContractAutomationEntry {
  name: string;
  deployedVersion?: number;
  taskContract?: unknown;
  settings?: unknown;
  presentation?: unknown;
}

/**
 * The DEPLOYED automations visible from one project's task board: the
 * project's own plus the organization-level ones — a contract can operate
 * tasks from either surface. When `projectId` is absent (all-projects board),
 * org-level listing includes project-bound automations so cross-project
 * choreography still resolves ownership.
 */
export function useTaskContractAutomations(
  organizationId: string,
  projectId: string | undefined,
): ContractAutomationEntry[] {
  // '' means "not known yet" (empty board, modal still loading) — skip rather
  // than fire a member-gated query for no organization.
  const orgQuery = useConvexQuery(
    'automations/queries:listAutomations',
    organizationId === ''
      ? 'skip'
      : {
          organizationId,
          // All-projects (no single projectId): include every project-bound
          // automation so drag choreography can resolve owners across the set.
          ...(projectId === undefined ? { includeProjectBound: true } : {}),
        },
  );
  const projectQuery = useConvexQuery(
    'automations/queries:listAutomations',
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
  /** The reader's locale — decides which declared name the surfaces show. */
  locale: string,
): ResolvedTaskSubjectContract[] {
  return automations.flatMap((automation) => {
    if (automation.deployedVersion === undefined) return [];
    const contract = parseTaskSubjectContract(automation.taskContract);
    if (contract === null) return [];
    const described = automationDisplayDescription(
      automation.presentation,
      locale,
    );
    return [
      {
        automationSlug: automation.name,
        displayName: automationDisplayName(
          automation.presentation,
          automation.name,
          locale,
        ),
        ...(described !== undefined && { displayDescription: described }),
        contract,
        settings: parseAutomationSettings(automation.settings),
      },
    ];
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
 * Classify a task into its ownership class. Ownership IS the assignment —
 * the worker the task belongs to — so the ASSIGNEE decides first:
 *
 * 1. An automation assignee (`assigneeType: 'app'`, `assigneeId` = store
 *    name) whose deployed contract resolves.
 * 2. An agent assignee.
 * 3. A HUMAN assignee is human ownership, full stop — an explicit handoff
 *    (take-over) must actually detach the choreography, or the assignee
 *    field lies about who drives the board verbs.
 * 4. Fallbacks for unassigned rows only: the creation stamp (`createdByType:
 *    'app'` — stamp-or-nothing: a task whose automation is gone never falls
 *    through to another), then a UNIQUE `externalSystem` match among the
 *    deployed contracts — ambiguity resolves to none; never guess an owner.
 *
 * Pure, so the rule is unit-testable.
 */
export function resolveTaskOwnership(
  task: TaskOwnershipFields,
  automations: ContractAutomationEntry[],
  locale: string,
): TaskOwnership {
  const entries = taskSubjectEntries(automations, locale);
  if (task.assigneeType === 'app' && task.assigneeId !== undefined) {
    const assigned = entries.find(
      (entry) => entry.automationSlug === task.assigneeId,
    );
    if (assigned) return { kind: 'automation', ...assigned };
  }
  if (task.assigneeType === 'agent' && task.assigneeId !== undefined) {
    return { kind: 'agent', agentId: task.assigneeId };
  }
  if (task.assigneeType === 'user') {
    return { kind: 'human' };
  }
  if (task.createdByType === 'app') {
    const stamped = entries.find(
      (entry) => entry.automationSlug === task.createdBy,
    );
    if (stamped) return { kind: 'automation', ...stamped };
    return { kind: 'human' };
  }
  if (task.externalSystem !== undefined && task.externalSystem !== '') {
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
  locale: string,
): ResolvedTaskSubjectContract | null {
  const ownership = resolveTaskOwnership(task, automations, locale);
  return ownership.kind === 'automation'
    ? {
        automationSlug: ownership.automationSlug,
        displayName: ownership.displayName,
        ...(ownership.displayDescription !== undefined && {
          displayDescription: ownership.displayDescription,
        }),
        contract: ownership.contract,
        settings: ownership.settings,
      }
    : null;
}

/** {@link resolveTaskSubjectContract} over the surfaces visible from the
 * task's project. */
export function useTaskSubjectContract(
  organizationId: string,
  task: (TaskOwnershipFields & { projectId: string }) | null | undefined,
): ResolvedTaskSubjectContract | null {
  const automations = useTaskContractAutomations(
    organizationId,
    task?.projectId,
  );
  const { locale } = useLocale();
  return useMemo(
    () => (task ? resolveTaskSubjectContract(task, automations, locale) : null),
    [automations, locale, task],
  );
}

/** The contracts a user can CREATE tasks from on this board (template
 *  creation) — `create.enabled` contracts of deployed automations. */
export function useTaskSubjectTemplates(
  organizationId: string,
  projectId: string | undefined,
): ResolvedTaskSubjectContract[] {
  const automations = useTaskContractAutomations(organizationId, projectId);
  const { locale } = useLocale();
  return useMemo(
    () =>
      taskSubjectEntries(automations, locale).filter(
        (entry) => entry.contract.create?.enabled === true,
      ),
    [automations, locale],
  );
}
