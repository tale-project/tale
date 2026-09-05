import type { ModelAccessConfig } from '../../../lib/shared/schemas/governance';
import { stripModelRefQualifier } from '../../../lib/shared/utils/model-ref';

export interface ModelAccessCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Resolve model access for a user by finding the most specific matching rule.
 *
 * Priority resolution (most specific wins):
 *   1. user  — rule where scope='user' and scopeId matches the userId
 *   2. team  — rules where scope='team' and scopeId is in the user's teamIds
 *              (multiple matching team rules are unioned: a model allowed by
 *              ANY matching team rule is considered allowed)
 *   3. role  — rule where scope='role' and scopeId matches the userRole
 *   4. default — rule where scope='default' (baseline for all org members)
 *
 * When no rule matches at any level, or the policy is disabled/missing,
 * all models are permitted (backward-compatible).
 */
function resolveAllowedAndBlockedModels(
  config: ModelAccessConfig,
  userId: string,
  teamIds: string[],
  userRole: string | undefined,
): { allowedModels: string[]; blockedModels: string[] } | null {
  const { rules } = config;

  // 1. User-scope rule (highest priority)
  const userRule = rules.find(
    (r) => r.scope === 'user' && r.scopeId === userId,
  );
  if (userRule) {
    return {
      allowedModels: userRule.allowedModels,
      blockedModels: userRule.blockedModels ?? [],
    };
  }

  // 2. Team-scope rules (union allowed models across all matching teams)
  const teamRules = rules.filter(
    (r) =>
      r.scope === 'team' && r.scopeId != null && teamIds.includes(r.scopeId),
  );
  if (teamRules.length > 0) {
    const allowedSet = new Set<string>();
    const blockedSet = new Set<string>();
    for (const rule of teamRules) {
      for (const m of rule.allowedModels) allowedSet.add(m);
      for (const m of rule.blockedModels ?? []) blockedSet.add(m);
    }
    return {
      allowedModels: [...allowedSet],
      blockedModels: [...blockedSet],
    };
  }

  // 3. Role-scope rule
  if (userRole) {
    const roleRule = rules.find(
      (r) => r.scope === 'role' && r.scopeId === userRole,
    );
    if (roleRule) {
      return {
        allowedModels: roleRule.allowedModels,
        blockedModels: roleRule.blockedModels ?? [],
      };
    }
  }

  // 4. Default-scope rule (lowest priority)
  const defaultRule = rules.find((r) => r.scope === 'default');
  if (defaultRule) {
    return {
      allowedModels: defaultRule.allowedModels,
      blockedModels: defaultRule.blockedModels ?? [],
    };
  }

  return null;
}

/**
 * Determine whether a single model is permitted for the given user context.
 *
 * - allowlist mode: model must be in allowedModels AND not in blockedModels
 * - blocklist mode: model is allowed unless it appears in blockedModels
 *   (allowedModels is ignored in blocklist mode since everything is allowed by default)
 */
function isModelPermitted(
  mode: ModelAccessConfig['mode'],
  allowedModels: string[],
  blockedModels: string[],
  modelId: string,
): boolean {
  const plainId = stripModelRefQualifier(modelId);
  const plainBlocked = blockedModels.map(stripModelRefQualifier);
  if (plainBlocked.includes(plainId)) {
    return false;
  }

  if (mode === 'allowlist') {
    const plainAllowed = allowedModels.map(stripModelRefQualifier);
    return plainAllowed.includes(plainId);
  }

  // blocklist mode: everything allowed except blocked
  return true;
}

/**
 * The rule resolution and the allow/block verdict over an already-loaded
 * policy — the 0.5 backend reads the policy FILE and hands it in here, so
 * every host applies exactly the same semantics.
 */
export function evaluateModelAccess(
  config: ModelAccessConfig | null,
  who: { userId: string; teamIds: string[]; userRole?: string | undefined },
  modelId: string,
): ModelAccessCheckResult {
  if (!config || !config.enabled || config.rules.length === 0) {
    return { allowed: true };
  }

  const resolved = resolveAllowedAndBlockedModels(
    config,
    who.userId,
    who.teamIds,
    who.userRole,
  );

  if (!resolved) {
    return { allowed: true };
  }

  const permitted = isModelPermitted(
    config.mode,
    resolved.allowedModels,
    resolved.blockedModels,
    modelId,
  );

  if (!permitted) {
    return {
      allowed: false,
      reason: `Model "${modelId}" is not available for your account. Contact your administrator to request access.`,
    };
  }

  return { allowed: true };
}

/** The accessible-models filter over an already-loaded policy — the 0.5
 * backend calls it directly over its file-read config. */
export function filterAccessibleModels(
  config: ModelAccessConfig | null,
  who: { userId: string; teamIds: string[]; userRole: string | undefined },
  allModelIds: string[],
): string[] {
  if (!config || !config.enabled || config.rules.length === 0) {
    return allModelIds;
  }
  const resolved = resolveAllowedAndBlockedModels(
    config,
    who.userId,
    who.teamIds,
    who.userRole,
  );
  if (!resolved) {
    return allModelIds;
  }
  return allModelIds.filter((modelId) =>
    isModelPermitted(
      config.mode,
      resolved.allowedModels,
      resolved.blockedModels,
      modelId,
    ),
  );
}

// Exported for unit testing only
export const _testInternals = {
  resolveAllowedAndBlockedModels,
  isModelPermitted,
};
