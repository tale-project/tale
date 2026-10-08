import { USAGE_LIMIT_REFUSAL_PREFIX } from '../../../lib/shared/usage-limit.ts';
import type { BudgetScope, BudgetViolation } from './budget-gate.ts';

const BUCKET_OWNER: Record<BudgetScope, string> = {
  user: 'Your',
  team: "Your team's",
  org: "The organization's",
  apiKey: "This API key's",
  project: "This project's",
};

const CAP_NAME: Record<BudgetViolation['code'], string> = {
  TOKEN_LIMIT: 'token',
  COST_LIMIT: 'cost',
  REQUEST_LIMIT: 'request',
};

/** The cap a violation names, as a sentence names it: "This API key's
 * monthly cost limit". */
export function budgetCapPhrase(violation: BudgetViolation): string {
  return `${BUCKET_OWNER[violation.scope]} ${violation.period} ${CAP_NAME[violation.code]} limit`;
}

/** The sentence a refused caller reads, whichever lane refused it (a chat
 * turn, an agent's image generation, a model-endpoint request, a direct
 * provider call) — it starts with "Usage limit reached" so a client that
 * only has the text still recognises it. A cap that still has room, but
 * too little for the work's worst case (an admission that holds the worst
 * case whole), says so rather than calling itself used up. */
export function budgetRefusalMessage(violation: BudgetViolation): string {
  const until = new Date(violation.resetsAt).toISOString();
  return violation.used < violation.limit
    ? `${USAGE_LIMIT_REFUSAL_PREFIX} ${budgetCapPhrase(violation)} leaves too little for this request until ${until}.`
    : `${USAGE_LIMIT_REFUSAL_PREFIX} ${budgetCapPhrase(violation)} is used up until ${until}.`;
}
