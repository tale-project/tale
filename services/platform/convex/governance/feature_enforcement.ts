import type {
  FeatureFlagsConfig,
  FeatureFlagRule,
} from '../../lib/shared/schemas/governance';
import type { QueryCtx } from '../lib/ctx';
import { readPolicyConfig } from './helpers';

export interface ResolvedFeatureFlags {
  webSearch: boolean;
  codeExecution: boolean;
  fileUpload: boolean;
  maxContextTokens?: number;
}

const DEFAULTS: ResolvedFeatureFlags = {
  webSearch: true,
  codeExecution: true,
  fileUpload: true,
};

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
 * Resolve feature flags for a user based on governance policies.
 *
 * Returns which features are enabled/disabled for this user.
 * When no policy exists, all features default to enabled.
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

  return {
    webSearch: rule.webSearch ?? DEFAULTS.webSearch,
    codeExecution: rule.codeExecution ?? DEFAULTS.codeExecution,
    fileUpload: rule.fileUpload ?? DEFAULTS.fileUpload,
    maxContextTokens: rule.maxContextTokens,
  };
}
