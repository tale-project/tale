import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  AUTOMATION_LLM_LIFETIME_MS,
  AUTOMATION_LLM_OP_KIND,
  type LlmAttemptAddress,
} from '../../core/automations/llm_budget.ts';
import { resolveAutomationRunAttribution } from '../sandbox/op-attribution.ts';
import { reconcileSessionOpKey } from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';

/** Every paid effect attempt owns one op; a resumed retry owns another. */
export function llmStepOp(args: {
  organizationId: string;
  runId: string;
  attempt: LlmAttemptAddress;
}): { sessionId: string; execId: string } {
  const hash = (parts: unknown[]): string =>
    createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return {
    sessionId: `automation-llm:${hash([args.organizationId, args.runId])}`,
    execId: hash([
      args.organizationId,
      args.runId,
      args.attempt.nodeId,
      args.attempt.itemIndex,
      args.attempt.pass,
      args.attempt.attempt,
    ]),
  };
}

export interface LlmStepReservation {
  organizationId: string;
  runId: string;
  attempt: LlmAttemptAddress;
  provider: string;
  model: string;
  reserveCents: number;
  reserveTokens: number;
}

/** The same whole-request hold used by model API calls, with the subject
 * and current durable effect attempt checked under the shared admission lock. */
export async function reserveLlmStepBudget(sql: Sql, args: LlmStepReservation) {
  if (
    !Number.isSafeInteger(args.reserveTokens) ||
    args.reserveTokens < 1 ||
    !Number.isFinite(args.reserveCents) ||
    args.reserveCents < 0 ||
    !Number.isSafeInteger(args.attempt.attempt) ||
    args.attempt.attempt < 1 ||
    !Number.isSafeInteger(args.attempt.itemIndex) ||
    !Number.isSafeInteger(args.attempt.pass) ||
    args.attempt.nodeId.length === 0 ||
    args.provider.length === 0 ||
    args.model.length === 0
  ) {
    throw new Error('Invalid direct LLM reservation');
  }
  const op = llmStepOp(args);
  const allowance = await reserveTurnBudget(sql, {
    organizationId: args.organizationId,
    ...op,
    kind: AUTOMATION_LLM_OP_KIND,
    // The model-ref format has a connector and a gateway-provider prefix.
    // Direct calls reuse that representation without creating a gateway.
    modelRef: `${args.provider}/${args.provider}/${args.model}`,
    defaultBudgetCents: Math.max(1, Math.ceil(args.reserveCents)),
    whole: { prospectiveTokens: args.reserveTokens },
    prepareSubject: async (tx) => {
      const live = await tx<{ id: string }[]>`
        SELECT a.id FROM app.automation_node_attempts a
        JOIN app.automation_runs r ON r.id = a.run_id AND r.org_id = a.org_id
        WHERE a.org_id = ${args.organizationId} AND a.run_id = ${args.runId}
          AND a.node_id = ${args.attempt.nodeId}
          AND a.item_index = ${args.attempt.itemIndex} AND a.pass = ${args.attempt.pass}
          AND a.attempt = ${args.attempt.attempt} AND a.kind = 'llm'
          AND a.status = 'started' AND r.status = 'running'
          AND a.claim_epoch = r.claim_epoch AND r.lease_epoch = r.claim_epoch
          AND r.lease_expires_at_ms > ${Date.now()}
        FOR SHARE OF a, r
      `;
      if (!live[0])
        throw new Error('The LLM effect attempt is no longer current');
      const prior = await tx<{ id: string }[]>`
        SELECT id FROM app.sandbox_session_ops
        WHERE session_id = ${op.sessionId} AND exec_id = ${op.execId}
      `;
      if (prior[0])
        throw new Error('The LLM effect attempt was already admitted');
      const subject = await resolveAutomationRunAttribution(tx, args);
      if (subject === null)
        throw new Error('The LLM run has no billing subject');
      return subject;
    },
  });
  return allowance.allowed ? { allowed: true as const, ...op } : allowance;
}

export interface LlmStepUsage {
  organizationId: string;
  sessionId: string;
  execId: string;
  /** Null means the provider outcome is unknown, never a reported zero. */
  usage: { inputTokens: number; outputTokens: number; cents: number } | null;
}

/** Persist terminal facts before attempting the idempotent shared settlement.
 * On a DB failure the existing hold survives and the watchdog recovers it. */
export async function recordLlmStepUsage(
  sql: Sql,
  args: LlmStepUsage,
): Promise<void> {
  const usage = args.usage;
  if (
    usage !== null &&
    (!Number.isSafeInteger(usage.inputTokens) ||
      usage.inputTokens < 0 ||
      !Number.isSafeInteger(usage.outputTokens) ||
      usage.outputTokens < 0 ||
      !Number.isFinite(usage.cents) ||
      usage.cents < 0)
  ) {
    throw new Error('Invalid direct LLM usage');
  }
  const now = Date.now();
  await sql`
    UPDATE app.sandbox_session_ops SET
      status = ${usage === null ? 'failed' : 'completed'},
      finalized_at_ms = ${now}, finished_at_ms = ${now},
      expected_cents = ${usage?.cents ?? null},
      input_tokens = ${usage?.inputTokens ?? null},
      output_tokens = ${usage?.outputTokens ?? null},
      settle_after_ms = CASE WHEN ${usage === null}
        THEN started_at_ms + ${AUTOMATION_LLM_LIFETIME_MS} ELSE ${now} END
    WHERE org_id = ${args.organizationId} AND session_id = ${args.sessionId}
      AND exec_id = ${args.execId} AND kind = ${AUTOMATION_LLM_OP_KIND}
      AND finalized_at_ms IS NULL AND spend_settled_at_ms IS NULL
  `;
  // Failure here leaves the persisted facts and hold for the existing sweep.
  const outcome = await reconcileSessionOpKey(sql, args);
  if (outcome === null) throw new Error('The direct LLM operation is missing');
}
