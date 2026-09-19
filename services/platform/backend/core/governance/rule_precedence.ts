/**
 * How governance rules COMBINE when several apply to one person — the one
 * doctrine every policy resolver (budgets, model access, default model,
 * feature flags) follows, so a member of two teams is treated the same way
 * by all four:
 *
 * 1. Specificity first: a `user` rule beats every `team` rule, which beats a
 *    `role` rule, which beats the `default`. Only the most specific tier that
 *    has a rule is read.
 * 2. Within the team tier, when the person belongs to SEVERAL teams that
 *    carry a rule:
 *    - a LIMIT (a budget cap, a context-window cap) combines to the
 *      STRICTEST value — joining a lenient team never raises anyone's cap;
 *    - a GRANT (a model allow-list) combines as the UNION, and a BLOCK
 *      anywhere wins — a team can only add models, a block removes them;
 *    - a single PICK (the default model) follows the policy's list order:
 *      the first matching team rule wins, and the editor lets an admin
 *      reorder them.
 *
 * The product docs state this once ("How rules combine"); this module is
 * where the code states it once.
 */

interface ScopedRule {
  readonly scope: string;
  readonly scopeId?: string | undefined;
}

/**
 * The team rules that apply to a member of `teamIds`, in the policy's list
 * order — every resolver's team tier starts from this same selection.
 */
export function matchingTeamRules<R extends ScopedRule>(
  rules: readonly R[],
  teamIds: readonly string[],
): R[] {
  if (teamIds.length === 0) return [];
  const mine = new Set(teamIds);
  return rules.filter(
    (rule) =>
      rule.scope === 'team' && rule.scopeId != null && mine.has(rule.scopeId),
  );
}

/** A LIMIT combines to the strictest (lowest) value; `undefined` = no cap. */
export function strictestCap(
  values: ReadonlyArray<number | null | undefined>,
): number | undefined {
  let out: number | undefined;
  for (const value of values) {
    if (value == null) continue;
    out = out === undefined ? value : Math.min(out, value);
  }
  return out;
}

/** A GRANT combines as the union of allow-lists; a block anywhere wins. */
export function unionAllowBlockWins(
  grants: ReadonlyArray<{
    readonly allowedModels: readonly string[];
    readonly blockedModels?: readonly string[] | undefined;
  }>,
): { allowedModels: string[]; blockedModels: string[] } {
  const allowed = new Set<string>();
  const blocked = new Set<string>();
  for (const grant of grants) {
    for (const model of grant.allowedModels) allowed.add(model);
    for (const model of grant.blockedModels ?? []) blocked.add(model);
  }
  return { allowedModels: [...allowed], blockedModels: [...blocked] };
}

/** A single PICK follows the list order: the first matching rule wins. */
export function firstInOrder<R>(rules: readonly R[]): R | undefined {
  return rules[0];
}
