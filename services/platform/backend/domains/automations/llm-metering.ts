import type { Sql } from 'postgres';

import { createPgUsageLedger } from '../chat/store.ts';
import { loadAttributedBudgetSubject } from '../governance/attributed-subject.ts';
import {
  budgetPolicyActive,
  findBudgetViolation,
} from '../governance/budget-gate.ts';
import { budgetRefusalMessage } from '../governance/budget-refusal.ts';
import { readInFlightReservations } from '../governance/budget-reservations.ts';
import { resolveAutomationRunAttribution } from '../sandbox/op-attribution.ts';

/**
 * An automation's `llm` step is a direct model call the organization pays
 * for, made outside any sandbox session — so its run is its billing subject
 * (`resolveAutomationRunAttribution`): the person who started the run, or
 * `__automation__` for a run a trigger started, under the automation's
 * name, with the key a keyed door used and the projects the run is in —
 * what the run's agent steps book under too.
 *
 * Before each call the step is measured against every cap that binds that
 * subject, counting what the work in flight holds, and refused once one is
 * reached; after it, the tokens the provider reported are priced from the
 * catalog and booked. The call holds nothing while it runs — one short
 * request, like a chat title — so steps of runs at the same moment can
 * pass a nearly reached cap together; their spend counts once booked.
 */

export type LlmStepAdmission =
  | { allowed: true }
  | { allowed: false; reason: string };

export async function checkLlmStepBudget(
  sql: Sql,
  args: { organizationId: string; runId: string },
): Promise<LlmStepAdmission> {
  if (!(await budgetPolicyActive(sql, args.organizationId))) {
    return { allowed: true };
  }
  const subject = await loadAttributedBudgetSubject(
    sql,
    args.organizationId,
    await resolveAutomationRunAttribution(sql, args),
  );
  const violation = await findBudgetViolation(sql, subject, {
    reservations: await readInFlightReservations(sql, subject),
  });
  return violation === null
    ? { allowed: true }
    : { allowed: false, reason: budgetRefusalMessage(violation) };
}

/** One call's spend, as the provider reported it. */
export interface LlmStepUsage {
  organizationId: string;
  runId: string;
  /** The serving connector's slug and the catalog id it was called with —
   * the pair the catalog prices. */
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function recordLlmStepUsage(
  sql: Sql,
  usage: LlmStepUsage,
): Promise<void> {
  const attribution = await resolveAutomationRunAttribution(sql, usage);
  if (attribution === null) {
    console.error(
      `[automations] run ${usage.runId} names no one to book its llm step to — ${usage.inputTokens} input and ${usage.outputTokens} output tokens of ${usage.provider}/${usage.model} are not booked`,
    );
    return;
  }
  await createPgUsageLedger(sql).record({
    organizationId: usage.organizationId,
    userId: attribution.userId,
    ...(attribution.apiKeyId !== undefined
      ? { apiKeyId: attribution.apiKeyId }
      : {}),
    ...(attribution.agentSlug !== undefined
      ? { agentSlug: attribution.agentSlug }
      : {}),
    model: usage.model,
    provider: usage.provider,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    ...(attribution.projectIds !== undefined
      ? { projectIds: attribution.projectIds }
      : {}),
  });
}
