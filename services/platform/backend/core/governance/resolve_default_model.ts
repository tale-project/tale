import type { DefaultModelRule } from '../../../lib/shared/schemas/governance';

/**
 * Find the most specific model rule that applies.
 * Priority: team > role > default
 */
export function findApplicableModelRule(
  rules: DefaultModelRule[],
  teamIds: string[],
  userRole?: string,
): DefaultModelRule | null {
  const teamRule = rules.find(
    (r) => r.scope === 'team' && r.scopeId && teamIds.includes(r.scopeId),
  );
  if (teamRule) return teamRule;

  if (userRole) {
    const roleRule = rules.find(
      (r) => r.scope === 'role' && r.scopeId === userRole,
    );
    if (roleRule) return roleRule;
  }

  return rules.find((r) => r.scope === 'default') ?? null;
}
