import type { BudgetScope, BudgetViolation } from './budget-gate.ts';

const BUCKET_OWNER: Record<BudgetScope, string> = {
  user: 'Your',
  team: "Your team's",
  org: "The organization's",
  apiKey: "This API key's",
};

const CAP_NAME: Record<BudgetViolation['code'], string> = {
  TOKEN_LIMIT: 'token',
  COST_LIMIT: 'cost',
  REQUEST_LIMIT: 'request',
};

/** The sentence a refused caller reads, whichever lane refused it (a chat
 * turn, an agent's image generation) — it starts with "Usage limit reached"
 * so a client that only has the text still recognises it. */
export function budgetRefusalMessage(violation: BudgetViolation): string {
  return `Usage limit reached. ${BUCKET_OWNER[violation.scope]} ${violation.period} ${CAP_NAME[violation.code]} limit is used up until ${new Date(violation.resetsAt).toISOString()}.`;
}
