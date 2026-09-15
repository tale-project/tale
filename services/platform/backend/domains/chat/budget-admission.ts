import type { Sql, TransactionSql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error.ts';
import {
  type BudgetViolation,
  findBudgetViolation,
  loadBudgetSubject,
} from '../governance/budget-gate.ts';

/**
 * The chat lane's budget admission. Every chat turn — the app's send,
 * regenerate and edit, both arena columns, a parked send the worker fires,
 * and a REST send — is measured against the caps that bind its sender
 * before it spends anything: their personal caps, their teams' shared caps,
 * the organization's, and, for a request an API key authenticated, the
 * key's own. A turn over a cap is refused with `BUDGET_EXCEEDED`, which
 * names the cap and when its period resets.
 */

export interface ChatBudgetRefusal {
  code: 'BUDGET_EXCEEDED';
  message: string;
  /** Whose bucket is spent: the sender's own, a team's, the
   * organization's, or the authenticating API key's. */
  scope: BudgetViolation['scope'];
  teamId?: string;
  /** Which cap: tokens, cost (cents) or requests. */
  limitCode: BudgetViolation['code'];
  period: BudgetViolation['period'];
  used: number;
  limit: number;
  /** When the binding period rolls over (epoch ms). */
  resetsAt: number;
}

export class ChatBudgetExceededError extends AppError<ChatBudgetRefusal> {
  constructor(refusal: ChatBudgetRefusal) {
    super(refusal);
    this.name = 'ChatBudgetExceededError';
  }
}

const BUCKET_OWNER: Record<BudgetViolation['scope'], string> = {
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

/** The sentence a refused sender reads — it starts with "Usage limit
 * reached" so a client that only has the text still recognises it. */
export function budgetRefusalMessage(violation: BudgetViolation): string {
  return `Usage limit reached. ${BUCKET_OWNER[violation.scope]} ${violation.period} ${CAP_NAME[violation.code]} limit is used up until ${new Date(violation.resetsAt).toISOString()}.`;
}

export function toChatBudgetRefusal(
  violation: BudgetViolation,
): ChatBudgetRefusal {
  return {
    code: 'BUDGET_EXCEEDED',
    message: budgetRefusalMessage(violation),
    scope: violation.scope,
    ...(violation.teamId !== undefined ? { teamId: violation.teamId } : {}),
    limitCode: violation.code,
    period: violation.period,
    used: violation.used,
    limit: violation.limit,
    resetsAt: violation.resetsAt,
  };
}

/** Seconds until the binding period resets — a refused caller's
 * `Retry-After`. Never below one. */
export function budgetRetryAfterSeconds(
  resetsAt: number,
  now: number = Date.now(),
): number {
  return Math.max(1, Math.ceil((resetsAt - now) / 1000));
}

/**
 * Refuse the turn when any cap that binds the sender is already reached.
 * The sender's teams and role are read at call time, so a worker firing a
 * parked or REST send measures them as they are now.
 */
export async function assertChatTurnBudget(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    apiKeyId?: string;
    now?: number;
  },
): Promise<void> {
  const subject = await loadBudgetSubject(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    ...(args.apiKeyId !== undefined ? { apiKeyId: args.apiKeyId } : {}),
  });
  const violation = await findBudgetViolation(
    sql,
    subject,
    args.now !== undefined ? { now: args.now } : {},
  );
  if (violation !== null) {
    throw new ChatBudgetExceededError(toChatBudgetRefusal(violation));
  }
}
