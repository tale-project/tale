'use client';

import { useMemo } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { CredentialRuntimeMismatchDetail } from '@/lib/shared/agents/readiness';

export type AgentReadinessMode =
  | 'internal'
  | 'image'
  | 'external-gateway-managed'
  | 'external-env-managed'
  | 'external-byo';

export type AgentAuthMode = 'managed' | 'byo';

export interface RequiredProvider {
  name: string;
  displayName?: string;
  baseUrl?: string;
  /** The provider already has a usable API key. */
  hasKey: boolean;
  /** The provider config exists in the org (so a key can be entered inline). */
  exists: boolean;
}

export interface RequiredEnvKey {
  key: string;
  secret: boolean;
  description?: string;
  /** A value is already set for this key in the agent's env store. */
  set: boolean;
}

export interface AgentReadiness {
  agentSlug: string;
  shortName: string;
  displayName: string;
  mode: AgentReadinessMode;
  agentKind?: 'claude-code' | 'cursor' | 'opencode';
  /** Saved runtime vs Environment credentials disagree — see pack `readiness.mismatch.*`. */
  credentialMismatch?: CredentialRuntimeMismatchDetail;
  /** Ready under the agent's CURRENT effective mode. */
  ready: boolean;
  /** ≥1 supported model resolves with current provider keys. */
  supportedModelsResolvable: boolean;
  /** Distinct providers referenced by supportedModels, with status. */
  requiredProviders: RequiredProvider[];
  /** Declared env/secrets with set-status. */
  requiredEnv: RequiredEnvKey[];
}

/** Narrow the `getAppAgentReadiness` (`v.any()`) result to its agents array. */
export function readAgentsResult(data: unknown): AgentReadiness[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() action-boundary read
  return (data as { agents?: AgentReadiness[] } | undefined)?.agents ?? [];
}

/** Is `agent` an external agent (the only kind whose auth mode is user-choosable)? */
export function isExternalAgent(agent: AgentReadiness): boolean {
  return (
    agent.mode === 'external-gateway-managed' ||
    agent.mode === 'external-env-managed' ||
    agent.mode === 'external-byo'
  );
}

/** The agent's auth mode as a managed/byo toggle value (external agents only). */
export function authModeOf(agent: AgentReadiness): AgentAuthMode {
  return agent.mode === 'external-byo' ? 'byo' : 'managed';
}

/**
 * Per-agent readiness for an app's bundled agents (the agent half of the install
 * readiness; the integration half is `getAppInstallState`). Backed by the
 * `getAppAgentReadiness` action, which returns facts for BOTH auth modes
 * (provider+model AND declared env) so the wizard can flip an external agent's
 * mode with a local toggle — no refetch. The wizard derives its provider-connect
 * and agent-secret steps from these agents plus the user's mode choices.
 */
export function useAppAgentReadiness(
  organizationId: string,
  appSlug: string,
  enabled = true,
): {
  agents: AgentReadiness[];
  externalAgents: AgentReadiness[];
  isLoading: boolean;
  refetch: () => void;
} {
  const q = useActionQuery(
    ['apps', 'agent-readiness', organizationId, appSlug],
    api.apps.agent_readiness.getAppAgentReadiness,
    { organizationId, appSlug },
    { enabled: enabled && organizationId !== '' && appSlug !== '' },
  );

  const agents = useMemo(() => readAgentsResult(q.data), [q.data]);
  const externalAgents = useMemo(
    () => agents.filter(isExternalAgent),
    [agents],
  );

  return {
    agents,
    externalAgents,
    isLoading: q.isLoading,
    refetch: () => void q.refetch(),
  };
}
