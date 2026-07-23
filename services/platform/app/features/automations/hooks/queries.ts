import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { listNodeTypesRef } from './backend';

/**
 * Read hooks for the automations surface. Everything about a stored automation
 * — its versions, its deployment, its triggers, its runs — is a reactive Convex
 * query, so a save, a deploy, or a run started next door propagates without any
 * manual invalidation, and a run in flight fills in as the stepper writes its
 * checkpoints.
 *
 * The node-type catalog is the exception: it comes from an ACTION (it reads the
 * shipped connector files), so it goes through `useActionQuery`.
 */

/** The org page's automations — or one project's when `projectId` is given.
 * The two surfaces never bleed: project-owned automations are absent from
 * the org listing and vice versa. */
export function useAutomations(
  organizationId: string,
  projectId?: Id<'projects'>,
) {
  return useConvexQuery(api.automations.queries.listAutomations, {
    organizationId,
    ...(projectId !== undefined && { projectId }),
  });
}

/** One version's document — the latest when `version` is omitted. */
export function useAutomation(
  organizationId: string,
  name: string,
  version?: number,
) {
  return useConvexQuery(api.automations.queries.getAutomation, {
    organizationId,
    name,
    ...(version !== undefined && { version }),
  });
}

/** The immutable version history of one automation, oldest first. */
export function useAutomationVersions(organizationId: string, name: string) {
  return useConvexQuery(api.automations.queries.listVersions, {
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
  projectId?: Id<'projects'>,
) {
  return useConvexQuery(api.automations.queries.listRuns, {
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
  runId: Id<'workflowRuns'> | undefined,
) {
  return useConvexQuery(
    api.automations.queries.getRun,
    runId === undefined ? 'skip' : { organizationId, runId },
  );
}

/** What starts one automation. */
export function useAutomationTriggers(organizationId: string, name: string) {
  return useConvexQuery(api.automations.queries.listTriggers, {
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
