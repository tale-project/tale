import { stripModelRefQualifier } from '../../../lib/shared/utils/model-ref';

/** Plain provider + model id pair (governance / platform defaults). */
export interface ModelOverride {
  providerName: string;
  modelId: string;
}

export interface ResolveExternalAgentModelInput {
  authMode: 'managed' | 'byo' | undefined;
  /** Managed Claude Code (gateway VK), not BYO or env-managed (Cursor). */
  gatewayManaged: boolean;
  supportedModels: readonly string[];
  /** User's explicit model pick for this turn (qualified ref or bare id). */
  explicitModelRef?: string;
  /** Org governance default (access-filtered when sourced from resolveDefaultModel). */
  governanceDefault: ModelOverride | null;
  /** Platform chat default when governance has none (gateway-managed, empty list). */
  platformDefault?: ModelOverride | null;
}

export interface ResolvedExternalAgentModels {
  /** Tale model ref sent as the turn's `modelRef` ('default' = unpinned). */
  primaryModelRef: string;
  /** Agent-configured fallbacks (`supportedModels[1:]`). Catalog `fallbackModelId`
   * is layered in `run_external_agent` on the resolved primary. */
  agentFallbackRefs: string[];
}

function formatQualifiedRef(model: ModelOverride): string {
  return model.providerName
    ? `${model.providerName}:${model.modelId}`
    : model.modelId;
}

function agentTailFallbacks(
  supportedModels: readonly string[],
  primaryRef: string,
): string[] {
  const primaryPlain = stripModelRefQualifier(primaryRef);
  return supportedModels.filter(
    (ref) => stripModelRefQualifier(ref) !== primaryPlain,
  );
}

/**
 * Resolve the primary model ref and agent-level fallback list for an external
 * agent turn. Pure so the BYO / managed / empty-list matrix is unit-testable;
 * `chat_turn_generate` supplies governance + platform defaults from live queries.
 */
export function resolveExternalAgentModelRefs(
  input: ResolveExternalAgentModelInput,
): ResolvedExternalAgentModels {
  const {
    authMode,
    gatewayManaged,
    supportedModels,
    explicitModelRef,
    governanceDefault,
    platformDefault,
  } = input;

  if (explicitModelRef) {
    return {
      primaryModelRef: explicitModelRef,
      agentFallbackRefs: agentTailFallbacks(supportedModels, explicitModelRef),
    };
  }

  const isByo = authMode === 'byo';

  // BYO and env-managed externals treat `supportedModels` as vendor-native ids.
  if (isByo || !gatewayManaged) {
    if (supportedModels.length > 0) {
      return {
        primaryModelRef: supportedModels[0],
        agentFallbackRefs: supportedModels.slice(1),
      };
    }
    // BYO with an empty list: member governance default, else credential default.
    if (isByo && governanceDefault) {
      return {
        primaryModelRef: formatQualifiedRef(governanceDefault),
        agentFallbackRefs: [],
      };
    }
    return { primaryModelRef: 'default', agentFallbackRefs: [] };
  }

  // Gateway-managed (Claude Code): catalog refs + governance when the list is empty.
  if (supportedModels.length > 0) {
    return {
      primaryModelRef: supportedModels[0],
      agentFallbackRefs: supportedModels.slice(1),
    };
  }

  const primary =
    governanceDefault !== null
      ? formatQualifiedRef(governanceDefault)
      : platformDefault !== null && platformDefault !== undefined
        ? formatQualifiedRef(platformDefault)
        : 'default';

  return { primaryModelRef: primary, agentFallbackRefs: [] };
}

/**
 * Pick the gateway `--fallback-model` id: first agent-configured fallback wins;
 * the catalog entry's `fallbackModelId` is supplied separately by the caller.
 */
export function pickExternalAgentExecFallback(
  agentFallbackRefs: readonly string[],
  catalogFallbackGatewayModel?: string,
): string | undefined {
  if (agentFallbackRefs.length > 0) {
    return agentFallbackRefs[0];
  }
  return catalogFallbackGatewayModel;
}

/** Tale refs to scope on the session VK (primary + agent fallbacks + catalog fallback). */
export function externalAgentVkAllowlist(
  primaryModelRef: string,
  agentFallbackRefs: readonly string[],
  catalogFallbackRef?: string,
  visionModelRef?: string,
): string[] {
  return [
    primaryModelRef,
    ...agentFallbackRefs,
    catalogFallbackRef,
    visionModelRef,
  ].filter(
    (ref): ref is string =>
      ref !== undefined && ref !== '' && ref !== 'default',
  );
}
