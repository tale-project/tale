/**
 * The scope of the cap a `BUDGET_EXCEEDED` refusal's `data` names — the
 * sender's own, a team's, a project's, the organization's — when it names
 * one. A project's cap is the project's, which Settings > Usage never lists,
 * so the chat names it apart.
 */
export function budgetScopeOf(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object' || !('scope' in data)) {
    return undefined;
  }
  return typeof data.scope === 'string' ? data.scope : undefined;
}
