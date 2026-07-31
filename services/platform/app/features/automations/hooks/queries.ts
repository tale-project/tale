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
  /** Org page: merge project-pinned automations into the listing. */
  includeProjectBound?: boolean,
) {
  return useConvexQuery(api.automations.queries.listAutomations, {
    organizationId,
    ...(projectId !== undefined && { projectId }),
    ...(includeProjectBound === true && { includeProjectBound: true }),
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
  runId: Id<'automationRuns'> | undefined,
) {
  return useConvexQuery(
    api.automations.queries.getRun,
    runId === undefined ? 'skip' : { organizationId, runId },
  );
}

/** The approval a waiting run is parked on — `skip` until the run's detail
 * names one. Reactive: approving elsewhere flips the card here. */
export function useRunApproval(
  organizationId: string,
  approvalId: Id<'approvals'> | undefined,
) {
  return useConvexQuery(
    api.approvals.queries.getApproval,
    approvalId === undefined ? 'skip' : { organizationId, approvalId },
  );
}

/** The live question a run's agent parked on (`ask_human`), null when nothing
 * waits on a person. Reactive: answering flips it to null everywhere. */
export function useRunPendingAsk(
  organizationId: string,
  runId: Id<'automationRuns'> | undefined,
) {
  return useConvexQuery(
    api.automations.human_asks.getPendingAskForRun,
    runId === undefined ? 'skip' : { organizationId, runId },
  );
}

/** The projects one automation is bound to — empty means org-level. */
export function useAutomationProjects(organizationId: string, name: string) {
  return useConvexQuery(api.automations.queries.listAutomationProjects, {
    organizationId,
    name,
  });
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

/** The provider connectors with their model catalogs — the builder dialog's
 * pick list. Developer-gated like the builder itself, and loaded only while
 * the dialog is open: a live catalog read can fan out to provider APIs. */
export function useBuilderModelCatalog(
  organizationId: string,
  enabled: boolean,
) {
  return useActionQuery(
    ['automations', 'builder-models', organizationId],
    api.lib.providers.catalog_actions.listProviderCatalogs,
    { organizationId },
    { enabled },
  );
}

/** The organization's provider credentials (masked). The dialog offers only
 * providers that hold an `api-key`/`env` credential — the two kinds a direct
 * builder model call may use. */
export function useBuilderCredentials(
  organizationId: string,
  enabled: boolean,
) {
  return useConvexQuery(
    api.provider_credentials.queries.listCredentials,
    enabled ? { organizationId } : 'skip',
  );
}
