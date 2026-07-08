import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { AutomationManifestI18n } from '@/lib/shared/schemas/automations';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

export function useListAgents(organizationId: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('agents', organizationId),
    api.agents.file_actions.listAgents,
    { organizationId },
    // Never fire with an empty org id: callers fall back to `''` while the org
    // context is still resolving (e.g. `useChatAgents(organizationId ?? '')`),
    // and `listAgents('')` makes the Better Auth adapter `db.get('')`, which
    // throws "Invalid ID length 0" server-side.
    { enabled: !!organizationId },
  );
  return { agents: data, isLoading, error, refetch };
}

/**
 * Live install-state for the agent catalog (which agents are installed/enabled
 * for the org, their provenance, and disabled reason). Reactive Convex query —
 * install/enable/disable mutations refresh it automatically.
 */
export function useAgentInstallations(organizationId: string) {
  return useConvexQuery(
    api.agents.installations.listInstallStates,
    { organizationId },
    { enabled: !!organizationId },
  );
}

export function useReadAgent(organizationId: string, agentName: string) {
  return useActionQuery(
    configKeys.detail('agents', organizationId, agentName),
    api.agents.file_actions.readAgent,
    { organizationId, agentName },
  );
}

export function useAgentHistory(organizationId: string, agentName: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.history('agents', organizationId, agentName),
    api.agents.file_actions.listHistory,
    { organizationId, agentName },
  );
  return { history: data, isLoading, error, refetch };
}

// ---------------------------------------------------------------------------
// Query-based hooks (DB reads — reactive)
// ---------------------------------------------------------------------------

export function useHasAgentsByTeam(teamId: string) {
  return useConvexQuery(api.agents.queries.hasBindingsByTeam, { teamId });
}

export function useAgentBinding(organizationId: string, agentSlug: string) {
  return useConvexQuery(api.agents.queries.getBindingByAgent, {
    organizationId,
    agentSlug,
  });
}

export type AvailableTool = ConvexItemOf<
  typeof api.agents.queries.getAvailableTools
>;

export function useAvailableTools() {
  const { data, isLoading } = useConvexQuery(
    api.agents.queries.getAvailableTools,
  );

  return {
    tools: data,
    isLoading,
  };
}

export type AvailableIntegration = ConvexItemOf<
  typeof api.agents.queries.getAvailableIntegrations
>;

export function useAvailableIntegrations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.agents.queries.getAvailableIntegrations,
    { organizationId },
  );

  return {
    integrations: data,
    isLoading,
  };
}

/**
 * One bindable workflow, as projected by `listWorkflows` (scoped to
 * `installed`) — backs the agent form's "Bound automations" picker
 * (`tool-selector.tsx#AutomationBindingsSection`). `slug` is the persisted
 * binding value (an agent's `workflowBindings`) — an automation-owned
 * workflow's slug IS its owning automation's slug, never renamed.
 *
 * When the workflow is owned by an automation (`automationSlug` set),
 * `automationName`/`automationDescription`/`automationI18n` carry the OWNING
 * AUTOMATION's self-translated display text, which the picker prefers over
 * `name`/`description` — resolve through `useAutomationDisplay`, never as raw
 * literals. A workflow with no owning automation (a standalone workflow, if
 * any remain) carries no automation fields; the picker falls back to
 * `name`/`description` (the workflow's own slug + spec summary).
 */
export type AvailableAutomation = {
  slug: string;
  name: string;
  description?: string;
  automationSlug?: string;
  automationName?: string;
  automationDescription?: string;
  automationI18n?: AutomationManifestI18n;
};

/** Narrows a `listWorkflows` entry to a well-formed bindable item — that
 *  action's Convex validator is `v.any()` and it also returns an
 *  `{ slug, status, message }` error stub in place of an unreadable workflow
 *  (mixed into the same array; see `event-create-dialog.tsx`'s workflow
 *  picker for the same guard), so validate at the boundary instead of
 *  trusting the shape. */
function isAvailableAutomation(item: unknown): item is AvailableAutomation {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { slug?: unknown }).slug === 'string' &&
    typeof (item as { name?: unknown }).name === 'string'
  );
}

/**
 * Installed workflows available to bind to an agent — `listWorkflows` scoped
 * to `installed` (an uninstalled template can't run, so it can't be bound).
 */
export function useAvailableWorkflows(organizationId: string) {
  const { data, isLoading } = useActionQuery(
    ['config', 'workflows', '_available', organizationId],
    api.workflows.file_actions.listWorkflows,
    { organizationId, filter: 'installed' },
  );

  return {
    workflows: (data as unknown[] | undefined)?.filter(isAvailableAutomation),
    isLoading,
  };
}

export type AgentWebhook = ConvexItemOf<
  typeof api.agents.webhooks.queries.getWebhooks
>;

export function useAgentWebhooks(organizationId: string, agentSlug: string) {
  const { data, isLoading } = useConvexQuery(
    api.agents.webhooks.queries.getWebhooks,
    { organizationId, agentSlug },
  );

  return {
    webhooks: data,
    isLoading,
  };
}
