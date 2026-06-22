/**
 * Pure classifier for an agent's setup dependencies — what must be configured
 * before the agent can run. Mirrors the integration-availability model
 * (`convex/integrations/availability.ts`): a small, side-effect-free function the
 * app-install readiness action wires filesystem + DB reads around, so the
 * decision tree is unit-testable in isolation.
 *
 * The buckets (the user-facing taxonomy):
 *  - internal (chat) / image-generation / external-MANAGED → the provider+model
 *    the agent uses must be configured (provider has a key, model resolves).
 *  - external-BYO → the agent's declared secrets/env must be set (it brings its
 *    own credential; supportedModels are hints, not a provider-key requirement).
 */
import { parseModelRef } from '../utils/model-ref';

export type ParsedModelRef = ReturnType<typeof parseModelRef>;

export type AgentReadinessMode =
  | 'internal'
  | 'image'
  | 'external-managed'
  | 'external-byo';

export interface RequiredEnvKey {
  key: string;
  secret: boolean;
  description?: string;
}

export interface AgentReadinessNeeds {
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
}

export function classifyAgentReadiness(
  agent: ClassifiableAgent,
): AgentReadinessNeeds {
  const primaryBehavior = agent.primaryBehavior ?? 'chat';
  const isExternal = primaryBehavior === 'external-agent';
  const isByo = isExternal && agent.authMode === 'byo';

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
      ? 'external-managed'
      : primaryBehavior === 'image-generation'
        ? 'image'
        : 'internal';

  return {
    mode,
    needsProviderModel: mode !== 'external-byo',
    needsEnv: mode === 'external-byo',
    providers,
    models,
    requiredEnv,
  };
}
