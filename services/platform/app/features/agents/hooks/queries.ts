import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/**
 * Read hooks for the agents area. Agents are org-config FILES (one YAML per
 * slug), so every read is a Convex ACTION behind `useActionQuery`, cached
 * under `configKeys` and invalidated by the write hooks next door — the same
 * wiring every file-backed config surface uses.
 */

/** The agents the viewer may use, plus per-file read failures. */
export function useAgents(organizationId: string) {
  return useActionQuery(
    configKeys.list('agents', organizationId),
    api.agents.actions.listAgents,
    { organizationId },
  );
}

/** One agent in full, or null when the viewer has none such. */
export function useAgent(organizationId: string, slug: string | null) {
  return useActionQuery(
    configKeys.detail('agents', organizationId, slug ?? ''),
    api.agents.actions.getAgent,
    { organizationId, slug: slug ?? '' },
    { enabled: !!slug },
  );
}

/** An agent's superseded versions, newest first. */
export function useAgentHistory(organizationId: string, slug: string | null) {
  return useActionQuery(
    configKeys.history('agents', organizationId, slug ?? ''),
    api.agents.actions.listAgentHistory,
    { organizationId, slug: slug ?? '' },
    { enabled: !!slug },
  );
}

/**
 * The org's capability catalog — the exact ids an agent's `tools` allowlist
 * narrows, as the turn pipeline registers them.
 */
export function useCapabilityCatalog(organizationId: string) {
  return useActionQuery(
    ['capabilities', organizationId],
    api.chat.capabilities_action.listCapabilities,
    { organizationId },
  );
}
