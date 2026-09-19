import type { DefaultModelRule } from '@tale/shared/schemas/governance';

import { firstInOrder, matchingTeamRules } from './rule_precedence.ts';

/**
 * Find the most specific model rule that applies.
 * Priority: team > role > default. A default model is a single PICK, so
 * when the person belongs to several teams that each name one, the first
 * matching team rule in the policy's list order wins (`rule_precedence.ts`)
 * — the editor lets an admin reorder the rules to say which.
 */
export function findApplicableModelRule(
  rules: DefaultModelRule[],
  teamIds: string[],
  userRole?: string,
): DefaultModelRule | null {
  const teamRule = firstInOrder(matchingTeamRules(rules, teamIds));
  if (teamRule) return teamRule;

  if (userRole) {
    const roleRule = rules.find(
      (r) => r.scope === 'role' && r.scopeId === userRole,
    );
    if (roleRule) return roleRule;
  }

  return rules.find((r) => r.scope === 'default') ?? null;
}
