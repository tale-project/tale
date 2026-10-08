import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import { estimateTurnCostCents } from '../chat/store.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import { budgetPolicyActive, type BudgetViolation } from './budget-gate.ts';
import { budgetRefusalMessage } from './budget-refusal.ts';
import { incrementUsageLedger } from './service.ts';

/**
 * A call the platform makes straight to a provider, with no gateway key in
 * between — an automation's `llm` step, a chat title, the Inbox's Improve,
 * voice output, a transcription, an embedding request — held against the
 * caps that bind whoever it is for, the way a managed turn holds its
 * allowance:
 *
 *  1. OPEN — before the call, its worst case is measured against every cap
 *     that binds its subject, after the booked spend and every hold in
 *     flight (`reserveTurnBudget`, kind `direct-call`, under the
 *     budget-admission lock), and admitted whole or not at all: a call
 *     whose worst case no longer fits is refused with the cap's own
 *     sentence. An admitted call's worst case is recorded as a hold on an
 *     op row (`app.sandbox_session_ops`, `session_id`
 *     `direct-call:<lane>`), stamped with the subject, the lane's label,
 *     the API key and the projects, where every later admission counts it.
 *  2. SETTLE — after the call, what it cost is booked into the usage ledger
 *     under that stamp, and the hold released, in one transaction. A call
 *     that spent nothing releases its hold without a booking.
 *  3. A call whose process died never settles: once its deadline passes,
 *     the sandbox watchdog releases its hold ({@link releaseStaleDirectCalls}),
 *     and a day after the call started the row goes
 *     ({@link sweepSettledDirectCalls}) — the ledger keeps the spend.
 *
 * Settling books once: the booked figure (`spent_cents`) is the gate, not
 * the released hold, so a call that outlives its deadline is still booked
 * when it does end. In an organization whose budget policy binds nothing,
 * a call holds nothing — there is no cap to overshoot — and its settle
 * books straight from the subject its lease carries.
 */

const DIRECT_CALL_OP_KIND = 'direct-call';

/** How long a settled call's row stays: the ledger keeps the spend. */
const SETTLED_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;
const SWEEP_MAX_BATCHES = 20;

/** Whose call it is, as the ledger books it. */
export interface DirectCallSubject {
  /** A person, `__automation__` for work nobody started, or the identity of
   * an API key that is not a person. */
  userId: string;
  /** The lane's label in the usage ledger: an automation's name,
   * `thread-title`, `inbox-improve`, `__tts__`, …. */
  agentSlug: string;
  apiKeyId?: string;
  projectIds?: readonly string[];
}

/** One admitted call: its hold's op row, when it holds one, and whose
 * call it is. */
export interface DirectCallLease {
  organizationId: string;
  sessionId: string;
  execId: string;
  /** Whether an op row holds the call — false while no budget binds. */
  held: boolean;
  subject: DirectCallSubject;
}

/** Whether a value handed back through an untyped seam is a lease this
 * module issued. */
export function isDirectCallLease(value: unknown): value is DirectCallLease {
  if (typeof value !== 'object' || value === null) return false;
  const subject: unknown = Reflect.get(value, 'subject');
  return (
    typeof Reflect.get(value, 'organizationId') === 'string' &&
    typeof Reflect.get(value, 'sessionId') === 'string' &&
    typeof Reflect.get(value, 'execId') === 'string' &&
    typeof Reflect.get(value, 'held') === 'boolean' &&
    typeof subject === 'object' &&
    subject !== null &&
    typeof Reflect.get(subject, 'userId') === 'string' &&
    typeof Reflect.get(subject, 'agentSlug') === 'string'
  );
}

export type DirectCallAdmission =
  | { allowed: true; lease: DirectCallLease }
  | { allowed: false; reason: string; violation?: BudgetViolation };

/** What a call may cost and use at most — the hold it takes. */
export interface DirectCallWorstCase {
  /** At the catalog price; held in whole cents, rounded up. */
  cents: number;
  tokens: number;
}

export async function openDirectCall(
  sql: Sql,
  args: {
    organizationId: string;
    /** Names the lane on the op row: `direct-call:<lane>`. */
    lane: string;
    subject: DirectCallSubject;
    worstCase: DirectCallWorstCase;
    /** `<providerSlug>/<modelId>`, the op row's record of the model. */
    modelRef?: string;
    /** The longest the call may take; past it, its hold lapses. */
    maxDurationMs: number;
  },
): Promise<DirectCallAdmission> {
  const lease: DirectCallLease = {
    organizationId: args.organizationId,
    sessionId: `${DIRECT_CALL_OP_KIND}:${args.lane}`,
    execId: randomUUID(),
    held: true,
    subject: args.subject,
  };
  if (!(await budgetPolicyActive(sql, args.organizationId))) {
    return { allowed: true, lease: { ...lease, held: false } };
  }
  const allowance = await reserveTurnBudget(sql, {
    organizationId: args.organizationId,
    sessionId: lease.sessionId,
    execId: lease.execId,
    kind: DIRECT_CALL_OP_KIND,
    defaultBudgetCents: Math.max(1, Math.ceil(args.worstCase.cents)),
    ...(args.modelRef !== undefined ? { modelRef: args.modelRef } : {}),
    subject: {
      userId: args.subject.userId,
      agentSlug: args.subject.agentSlug,
      ...(args.subject.apiKeyId !== undefined
        ? { apiKeyId: args.subject.apiKeyId }
        : {}),
      ...(args.subject.projectIds !== undefined &&
      args.subject.projectIds.length > 0
        ? { projectIds: args.subject.projectIds }
        : {}),
    },
    whole: { prospectiveTokens: Math.max(0, Math.ceil(args.worstCase.tokens)) },
    deadlineAtMs: Date.now() + args.maxDurationMs,
  });
  if (allowance.allowed) return { allowed: true, lease };
  return {
    allowed: false,
    reason:
      allowance.violation !== undefined
        ? budgetRefusalMessage(allowance.violation)
        : allowance.reason,
    ...(allowance.violation !== undefined
      ? { violation: allowance.violation }
      : {}),
  };
}

/** A text model's call, by its connector and catalog id. */
export interface TokenCallModel {
  organizationId: string;
  /** The serving connector's slug and the catalog id it is called with —
   * the pair the catalog prices. */
  provider: string;
  model: string;
}

/**
 * Open a text model's call: its worst case is the prompt plus its whole
 * output cap, at the catalog price (`estimateTurnCostCents`, the price the
 * booking uses too).
 */
export async function openTokenCall(
  sql: Sql,
  args: TokenCallModel & {
    lane: string;
    subject: DirectCallSubject;
    promptTokens: number;
    maxOutputTokens: number;
    maxDurationMs: number;
  },
): Promise<DirectCallAdmission> {
  const cents = await estimateTurnCostCents(sql, {
    organizationId: args.organizationId,
    provider: args.provider,
    model: args.model,
    inputTokens: args.promptTokens,
    outputTokens: args.maxOutputTokens,
  });
  return openDirectCall(sql, {
    organizationId: args.organizationId,
    lane: args.lane,
    subject: args.subject,
    worstCase: {
      cents,
      tokens: args.promptTokens + args.maxOutputTokens,
    },
    modelRef: `${args.provider}/${args.model}`,
    maxDurationMs: args.maxDurationMs,
  });
}

/** Book a text model's call at the catalog price in its hold's place. */
export async function settleTokenCall(
  sql: Sql,
  lease: DirectCallLease,
  usage: TokenCallModel & {
    inputTokens: number;
    outputTokens: number;
    /** The prompt-cache hits among `inputTokens`, priced at their rate. */
    cachedInputTokens?: number;
  },
): Promise<'settled' | 'already_settled'> {
  const costCents = await estimateTurnCostCents(sql, {
    organizationId: usage.organizationId,
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
  });
  return settleDirectCall(sql, lease, {
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costCents,
  });
}

/** What a call cost, as the provider reported it and the catalog priced it. */
export interface DirectCallSpend {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Priced by the caller: the catalog's token price (prompt-cache hits at
   * their own rate), a voice's per-character price, …. */
  costCents: number;
  /** Voice output's measure. */
  characterCount?: number;
  /** A transcription's measure. */
  audioDurationSec?: number;
}

/**
 * Book the call's spend under its op row's stamp and release its hold, in
 * one transaction. `'already_settled'` when it was booked before — a replay
 * books nothing twice.
 */
export async function settleDirectCall(
  sql: Sql,
  lease: DirectCallLease,
  spend: DirectCallSpend,
): Promise<'settled' | 'already_settled'> {
  const now = Date.now();
  if (!lease.held) {
    await sql.begin((tx) =>
      bookDirectCall(
        tx,
        lease.organizationId,
        {
          userId: lease.subject.userId,
          agentSlug: lease.subject.agentSlug,
          apiKeyId: lease.subject.apiKeyId ?? null,
          projectIds:
            lease.subject.projectIds !== undefined
              ? [...lease.subject.projectIds]
              : null,
        },
        spend,
        now,
      ),
    );
    return 'settled';
  }
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        userId: string | null;
        agentSlug: string | null;
        apiKeyId: string | null;
        projectIds: string[] | null;
      }[]
    >`
      UPDATE app.sandbox_session_ops SET
        status = 'completed',
        spent_cents = ${spend.costCents},
        input_tokens = ${spend.inputTokens},
        output_tokens = ${spend.outputTokens},
        spend_settled_at_ms = coalesce(spend_settled_at_ms, ${now}),
        finalized_at_ms = coalesce(finalized_at_ms, ${now}),
        finished_at_ms = coalesce(finished_at_ms, ${now})
      WHERE org_id = ${lease.organizationId}
        AND session_id = ${lease.sessionId} AND exec_id = ${lease.execId}
        AND kind = ${DIRECT_CALL_OP_KIND} AND spent_cents IS NULL
      RETURNING user_id AS "userId", agent_slug AS "agentSlug",
        api_key_id AS "apiKeyId", project_ids AS "projectIds"
    `;
    const op = rows[0];
    if (op === undefined) return 'already_settled';
    await bookDirectCall(tx, lease.organizationId, op, spend, now);
    return 'settled';
  });
}

async function bookDirectCall(
  tx: TransactionSql,
  organizationId: string,
  op: {
    userId: string | null;
    agentSlug: string | null;
    apiKeyId: string | null;
    projectIds: string[] | null;
  },
  spend: DirectCallSpend,
  now: number,
): Promise<void> {
  await incrementUsageLedger(tx, {
    organizationId,
    // Every lane names a subject; a row without one is nobody's spend.
    userId: op.userId ?? AUTOMATION_SUBJECT_ID,
    ...(op.apiKeyId !== null ? { apiKeyId: op.apiKeyId } : {}),
    ...(op.agentSlug !== null ? { agentSlug: op.agentSlug } : {}),
    ...(op.projectIds !== null && op.projectIds.length > 0
      ? { projectIds: op.projectIds }
      : {}),
    model: spend.model,
    provider: spend.provider,
    inputTokens: spend.inputTokens,
    outputTokens: spend.outputTokens,
    costEstimateCents: spend.costCents,
    ...(spend.characterCount !== undefined
      ? { characterCount: spend.characterCount }
      : {}),
    ...(spend.audioDurationSec !== undefined
      ? { audioDurationSec: spend.audioDurationSec }
      : {}),
    timestamp: now,
  });
}

/** Release the hold of a call that spent nothing — refused upstream before
 * any work, or cancelled before it was sent — without a booking. */
export async function releaseDirectCall(
  sql: Sql | TransactionSql,
  lease: DirectCallLease,
): Promise<void> {
  if (!lease.held) return;
  const now = Date.now();
  await sql`
    UPDATE app.sandbox_session_ops SET
      status = 'cancelled',
      spend_settled_at_ms = ${now},
      finalized_at_ms = coalesce(finalized_at_ms, ${now}),
      finished_at_ms = coalesce(finished_at_ms, ${now})
    WHERE org_id = ${lease.organizationId}
      AND session_id = ${lease.sessionId} AND exec_id = ${lease.execId}
      AND kind = ${DIRECT_CALL_OP_KIND} AND spend_settled_at_ms IS NULL
  `;
}

/**
 * The sandbox watchdog's pass over calls whose process died mid-call: a
 * hold past its deadline stops counting. A call that does end after this
 * is still booked when it settles.
 */
export async function releaseStaleDirectCalls(
  sql: Sql,
  now: number = Date.now(),
): Promise<number> {
  // `kind = 'direct-call'` is written as a literal so the planner can match
  // the partial index `sandbox_session_ops_direct_call_open` (0156).
  const released = await sql<{ id: string }[]>`
    UPDATE app.sandbox_session_ops SET
      status = 'failed',
      spend_settled_at_ms = ${now},
      finalized_at_ms = coalesce(finalized_at_ms, ${now}),
      finished_at_ms = coalesce(finished_at_ms, ${now})
    WHERE kind = 'direct-call' AND spend_settled_at_ms IS NULL
      AND deadline_ms < ${now}
    RETURNING id
  `;
  return released.length;
}

/** Delete settled call rows a day after their call started, oldest first
 * and in bounded batches: the row only carried the hold. */
export async function sweepSettledDirectCalls(
  sql: Sql,
  options: { now?: number } = {},
): Promise<number> {
  const cutoff = (options.now ?? Date.now()) - SETTLED_ROW_RETENTION_MS;
  let deleted = 0;
  for (let round = 0; round < SWEEP_MAX_BATCHES; round += 1) {
    // The literal kind matches the partial index
    // `sandbox_session_ops_direct_call_started` (0156).
    const rows = await sql<{ id: string }[]>`
      DELETE FROM app.sandbox_session_ops
      WHERE id IN (
        SELECT id FROM app.sandbox_session_ops
        WHERE kind = 'direct-call'
          AND spend_settled_at_ms IS NOT NULL
          AND started_at_ms < ${cutoff}
        ORDER BY started_at_ms
        LIMIT ${SWEEP_BATCH}
      )
      RETURNING id
    `;
    deleted += rows.length;
    if (rows.length < SWEEP_BATCH) break;
  }
  return deleted;
}
