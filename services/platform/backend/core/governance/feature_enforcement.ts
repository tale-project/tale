import type {
  FeatureFlagsConfig,
  FeatureFlagRule,
} from '../../../lib/shared/schemas/governance';

/**
 * What the `feature_flags` policy actually controls: the context-window cap
 * for a user's chat turns. The `webSearch` / `codeExecution` / `fileUpload`
 * toggles older policy files may still carry are deprecated and ignored —
 * nothing on the server or the client ever enforced them, so resolving them
 * only advertised controls that did nothing.
 */
export interface ResolvedFeatureFlags {
  /** Context-window cap for the user's chat turns; absent = no cap. */
  maxContextTokens?: number;
}

const DEFAULTS: ResolvedFeatureFlags = {};

/**
 * Find the most specific feature flag rule.
 * Priority: user > team > role > default
 */
function findApplicableRule(
  rules: FeatureFlagRule[],
  userId: string,
  teamIds: string[],
  role?: string,
): FeatureFlagRule | null {
  const userRule = rules.find(
    (r) => r.scope === 'user' && r.scopeId === userId,
  );
  if (userRule) return userRule;

  const teamRule = rules.find(
    (r) => r.scope === 'team' && r.scopeId && teamIds.includes(r.scopeId),
  );
  if (teamRule) return teamRule;

  if (role) {
    const roleRule = rules.find(
      (r) => r.scope === 'role' && r.scopeId === role,
    );
    if (roleRule) return roleRule;
  }

  return rules.find((r) => r.scope === 'default') ?? null;
}

/**
 * Rule selection over an already-loaded policy — the 0.5 backend reads the
 * policy FILE and hands it in here, so every host applies exactly the same
 * semantics. When no policy exists, the policy is disabled, or no rule
 * matches, no cap applies.
 */
export function evaluateFeatureFlags(
  config: FeatureFlagsConfig | null,
  who: { userId: string; teamIds: string[]; role?: string | undefined },
): ResolvedFeatureFlags {
  if (!config || !config.enabled || config.rules.length === 0) {
    return { ...DEFAULTS };
  }

  const rule = findApplicableRule(
    config.rules,
    who.userId,
    who.teamIds,
    who.role,
  );
  if (!rule) {
    return { ...DEFAULTS };
  }

  return { maxContextTokens: rule.maxContextTokens };
}
