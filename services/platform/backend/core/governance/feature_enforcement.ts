import type {
  FeatureFlagsConfig,
  FeatureFlagRule,
} from '../../../lib/shared/schemas/governance';
import type { QueryCtx } from '../lib/ctx';
import { readPolicyConfig } from './helpers';

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
 * Resolve the feature-flag policy for a user.
 *
 * When no policy exists, the policy is disabled, or no rule matches, no cap
 * applies.
 */
export async function resolveFeatureFlags(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
  teamIds: string[],
  role?: string,
): Promise<ResolvedFeatureFlags> {
  const config = await readPolicyConfig<FeatureFlagsConfig>(
    ctx,
    organizationId,
    'feature_flags',
  );
  return evaluateFeatureFlags(config, { userId, teamIds, role });
}

/**
 * The PURE half of {@link resolveFeatureFlags} — rule selection over an
 * already-loaded policy. Exported so a host with its own policy source (the
 * 0.5 backend reads policy FILES) applies exactly the same semantics.
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
