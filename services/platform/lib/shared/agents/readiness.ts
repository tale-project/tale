/**
 * Pure classifier for an agent's setup dependencies — what must be configured
 * before the agent can run. Mirrors the integration-availability model
 * (`convex/integrations/availability.ts`): a small, side-effect-free function the
 * app-install readiness action wires filesystem + DB reads around, so the
 * decision tree is unit-testable in isolation.
 *
 * The buckets (the user-facing taxonomy):
 *  - internal (chat) / image-generation / external-GATEWAY-managed → the provider+model
 *    the agent uses must be configured (provider has a key, model resolves).
 *  - external-ENV-managed → managed external agent whose runtime reads credentials
 *    from the session env (not the platform gateway); declared env/secrets must be set.
 *  - external-BYO → the agent's declared secrets/env must be set (it brings its
 *    own credential; supportedModels are hints, not a provider-key requirement).
 */
import { parseModelRef } from '../utils/model-ref';

type ParsedModelRef = ReturnType<typeof parseModelRef>;

type AgentReadinessMode =
  | 'internal'
  | 'image'
  | 'external-gateway-managed'
  | 'external-env-managed'
  | 'external-byo';

interface RequiredEnvKey {
  key: string;
  secret: boolean;
  description?: string;
}

interface AgentReadinessNeeds {
  mode: AgentReadinessMode;
  /** Provider+model must be configured (provider key present, model resolvable). */
  needsProviderModel: boolean;
  /** The declared env/secrets must be set. */
  needsEnv: boolean;
  /** Distinct provider slugs referenced by `supportedModels` (qualified refs only). */
  providers: string[];
  /** Parsed `supportedModels`. */
  models: ParsedModelRef[];
  /** Declared required env/secret keys (from `metadata.requires.env`). */
  requiredEnv: RequiredEnvKey[];
}

/** The agent-config fields the classifier reads — a structural subset. */
export interface ClassifiableAgent {
  primaryBehavior?: 'chat' | 'image-generation' | 'external-agent';
  authMode?: 'managed' | 'byo';
  supportedModels?: readonly string[];
  /** From `metadata.requires.env`. */
  requiredEnv?: ReadonlyArray<{
    key: string;
    secret?: boolean;
    description?: string;
  }>;
  /**
   * Managed external agents only: where credentials come from. Defaults to
   * `'gateway'` (Claude Code). `'agent-env'` means the runtime uses session
   * env keys (e.g. Cursor CURSOR_API_KEY) even in managed mode.
   */
  credentialManagedSource?: 'gateway' | 'agent-env';
}

export function classifyAgentReadiness(
  agent: ClassifiableAgent,
): AgentReadinessNeeds {
  const primaryBehavior = agent.primaryBehavior ?? 'chat';
  const isExternal = primaryBehavior === 'external-agent';
  const isByo = isExternal && agent.authMode === 'byo';
  const managedSource = agent.credentialManagedSource ?? 'gateway';

  const models = (agent.supportedModels ?? []).map((ref) => parseModelRef(ref));
  const providers = Array.from(
    new Set(
      models
        .map((m) => m.providerName)
        .filter((p): p is string => typeof p === 'string' && p.length > 0),
    ),
  );
  const requiredEnv: RequiredEnvKey[] = (agent.requiredEnv ?? []).map((e) => ({
    key: e.key,
    secret: e.secret ?? false,
    ...(e.description !== undefined && { description: e.description }),
  }));

  const mode: AgentReadinessMode = isByo
    ? 'external-byo'
    : isExternal
      ? managedSource === 'agent-env'
        ? 'external-env-managed'
        : 'external-gateway-managed'
      : primaryBehavior === 'image-generation'
        ? 'image'
        : 'internal';

  return {
    mode,
    needsProviderModel:
      mode === 'internal' ||
      mode === 'image' ||
      mode === 'external-gateway-managed',
    needsEnv: mode === 'external-byo' || mode === 'external-env-managed',
    providers,
    models,
    requiredEnv,
  };
}
