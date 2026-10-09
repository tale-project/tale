import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { ReplayRequestArgs } from '@/app/lib/backend/contract/automations';

import { listNodeTypesRef } from './backend';

/**
 * Read hooks for the automations surface — an automation's versions,
 * deployment, triggers, and runs. These key under the 0.5 backend's query
 * vocabulary (`['backend', orgId, entity, ...]`); a save, a deploy, or a run
 * state change emits an entity hint over SSE (`automation` / `automation_run`)
 * that the `useBackendHints` bridge maps to an invalidation, so a run in
 * flight fills in as the stepper writes its checkpoints — without a manual
 * reload.
 *
 * The node-type catalog is the exception: it comes from an ACTION (it reads the
 * shipped connector files), so it goes through `useActionQuery`.
 */

/** The skills + enabled connectors an automation's agent node can equip —
 * org-scoped, widened to a project's team skills when authored in a project.
 * Developer-gated (the automation create lane already is). */
export function useAutomationCapabilities(
  organizationId: string,
  projectId: string | undefined,
  enabled: boolean,
) {
  return useActionQuery(
    ['automations', 'capabilities', organizationId, projectId ?? ''],
    'chat/composer:listAutomationCapabilities',
    { organizationId, ...(projectId !== undefined ? { projectId } : {}) },
    { enabled },
  );
}

/** The org page's automations — or one project's when `projectId` is given.
 * The two surfaces never bleed: project-owned automations are absent from
 * the org listing and vice versa. Skipped without an organization. */
export function useAutomations(
  organizationId: string | undefined,
  projectId?: string,
  /** Org page: merge project-pinned automations into the listing. */
  includeProjectBound?: boolean,
) {
  return useBackendQuery(
    'automations/queries:listAutomations',
    organizationId === undefined
      ? 'skip'
      : {
          organizationId,
          ...(projectId !== undefined && { projectId }),
          ...(includeProjectBound === true && { includeProjectBound: true }),
        },
  );
}

/** One version's document — the latest when `version` is omitted. */
export function useAutomation(
  organizationId: string,
  name: string,
  version?: number,
) {
  return useBackendQuery('automations/queries:getAutomation', {
    organizationId,
    name,
    ...(version !== undefined && { version }),
  });
}

/** The immutable version history of one automation, oldest first. */
export function useAutomationVersions(organizationId: string, name: string) {
  return useBackendQuery('automations/queries:listVersions', {
    organizationId,
    name,
  });
}

/** Recent runs, newest first — of one automation, or of the whole
 * organization when `name` is omitted; `projectId` narrows to one project's
 * run log. */
export function useAutomationRuns(
  organizationId: string,
  name?: string,
  limit?: number,
  projectId?: string,
) {
  return useBackendQuery('automations/queries:listRuns', {
    organizationId,
    ...(name !== undefined && { name }),
    ...(limit !== undefined && { limit }),
    ...(projectId !== undefined && { projectId }),
  });
}

/** One run in full — the trace, the effects, and the per-node checkpoints the
 * canvas overlays. */
export function useAutomationRun(
  organizationId: string,
  runId: string | undefined,
) {
  return useBackendQuery(
    'automations/queries:getRun',
    runId === undefined ? 'skip' : { organizationId, runId },
  );
}

/** The approval a waiting run is parked on — `skip` until the run's detail
 * names one. Reactive: approving elsewhere flips the card here. */
export function useRunApproval(
  organizationId: string,
  approvalId: string | undefined,
) {
  return useBackendQuery(
    'approvals/queries:getApproval',
    approvalId === undefined ? 'skip' : { organizationId, approvalId },
  );
}

/** The live question a run's agent parked on (`ask_human`), null when nothing
 * waits on a person. Reactive: answering flips it to null everywhere. */
export function useRunPendingAsk(
  organizationId: string,
  runId: string | undefined,
) {
  return useBackendQuery(
    'automations/human_asks:getPendingAskForRun',
    runId === undefined ? 'skip' : { organizationId, runId },
  );
}

/** The write a run waits on a person about — a call that may already have
 * reached its service when the run was interrupted; null when nothing of the
 * kind waits. Reactive: a decision taken anywhere clears it. */
export function useRunInDoubt(
  organizationId: string,
  runId: string | undefined,
) {
  return useBackendQuery(
    'automations/queries:getRunInDoubt',
    runId === undefined ? 'skip' : { organizationId, runId },
  );
}

/** One automation's runs, newest first, a page at a time, narrowed to the
 * statuses and mode the Runs table asks for. */
export function useAutomationRunsPage(args: {
  organizationId: string;
  name: string;
  projectId?: string;
  statuses?: readonly string[];
  mode?: 'mock' | 'live';
}) {
  return useCachedPaginatedQuery(
    'automations/queries:listRunsPaginated',
    {
      organizationId: args.organizationId,
      name: args.name,
      ...(args.projectId !== undefined && { projectId: args.projectId }),
      ...(args.statuses !== undefined &&
        args.statuses.length > 0 && { statuses: [...args.statuses] }),
      ...(args.mode !== undefined && { mode: args.mode }),
    },
    { initialNumItems: DEFAULT_LIST_PAGE_SIZE },
  );
}

/** A run step by step: the record the run view reads — every step with
 * its status, decisions explained, skip chain, failure and value glimpses.
 * A finished run's record does not change, so it is not read again. */
export function useRunRecord(
  organizationId: string,
  runId: string | undefined,
  options: { travels?: boolean; finished?: boolean } = {},
) {
  return useBackendQuery(
    'automations/queries:getRunRecord',
    runId === undefined
      ? 'skip'
      : {
          organizationId,
          runId,
          ...(options.travels === true && { travels: true }),
        },
    options.finished === true
      ? { staleTime: Number.POSITIVE_INFINITY }
      : undefined,
  );
}

/** One unit of a run read whole — a step, or one of its items or passes:
 * its values, rendered text, reads, change and call. */
export function useRunNode(
  organizationId: string,
  runId: string | undefined,
  unit: { node: string; item?: number; pass?: number } | undefined,
) {
  return useBackendQuery(
    'automations/queries:getRunNode',
    runId === undefined || unit === undefined
      ? 'skip'
      : { organizationId, runId, ...unit },
  );
}

/** A page of a step's items and passes, failed ones alone on request. */
export function useRunItems(
  organizationId: string,
  runId: string | undefined,
  page:
    | {
        node: string;
        cursor?: string;
        limit?: number;
        status?: 'all' | 'failed';
      }
    | undefined,
) {
  return useBackendQuery(
    'automations/queries:getRunItems',
    runId === undefined || page === undefined
      ? 'skip'
      : { organizationId, runId, ...page },
  );
}

/** Two runs of one automation side by side. */
export function useRunCompare(
  organizationId: string,
  runId: string | undefined,
  otherRunId: string | undefined,
) {
  return useBackendQuery(
    'automations/queries:compareRuns',
    runId === undefined || otherRunId === undefined
      ? 'skip'
      : { organizationId, runId, otherRunId },
  );
}

/** What running a run again would do, before it starts. */
export function useReplayPlan(
  organizationId: string,
  runId: string | undefined,
  request: ReplayRequestArgs | undefined,
) {
  return useBackendQuery(
    'automations/queries:getReplayPlan',
    runId === undefined || request === undefined
      ? 'skip'
      : { organizationId, runId, ...request },
  );
}

/** The projects one automation is bound to — empty means org-level. */
export function useAutomationProjects(organizationId: string, name: string) {
  return useBackendQuery('automations/queries:listAutomationProjects', {
    organizationId,
    name,
  });
}

/** What starts one automation. */
export function useAutomationTriggers(organizationId: string, name: string) {
  return useBackendQuery('automations/queries:listTriggers', {
    organizationId,
    name,
  });
}

/** Every node type the engine has registered — see `backend.ts` for why this
 * one call is bound by name. */
export function useNodeTypeCatalog(organizationId: string) {
  return useActionQuery(
    ['automations', 'node-types', organizationId],
    listNodeTypesRef,
    { organizationId },
  );
}
