import type { Sql, TransactionSql } from 'postgres';

import {
  AUTOMATION_LLM_OP_KIND,
  AUTOMATION_LLM_LIFETIME_MS,
} from '../../core/automations/llm_budget.ts';
import {
  type GatewayKeySettlementOutcome,
  type GatewayKeySettlementPort,
  type GatewaySpendReading,
  settleGatewayKey,
  settlementPending,
} from '../../core/node_only/sandbox/gateway_key_settlement.ts';
import {
  readVirtualKeySpend,
  revokeVirtualKey,
} from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { incrementUsageLedger } from '../governance/service.ts';
import {
  resolveSessionOpAttribution,
  withSessionOpBillingProjects,
  splitModelRef,
} from './op-attribution.ts';

/**
 * The PG side of a turn's spend settlement: the durable facts on the op row
 * (`spend_settled_at_ms`, `key_revoked_at_ms`, `spent_cents`), the usage
 * ledger booking that rides the spend stamp, and the reconcile entry points
 * — the settle's retry job and the sandbox watchdog's sweep — that finish
 * what a host's own attempt could not. The choreography itself is the shared
 * `settleGatewayKey`; this module only supplies its PG port.
 */

/** How long a finalized op's settlement may stay open before the watchdog
 * sweep picks it up — the host's own attempt and its scheduled retries get
 * this long first. */
const GATEWAY_KEY_RECONCILE_MIN_AGE_MS = 2 * 60_000;

/** How long after an op ended a zero gateway reading is taken for "not
 * booked yet" when the relay saw a priced answer (`expected_cents`): the
 * gateway books a call's cost after the answer has left, and a reading that
 * raced it would otherwise book nothing for good. Past this, the relay's own
 * figure is booked instead. */
export const ZERO_READING_GRACE_MS = 10 * 60_000;

/**
 * What an op's own row says about its spend beyond the gateway's figure —
 * written by a model-endpoint request when it ends (`domains/model_api/
 * metering.ts`; every other op leaves them NULL):
 *
 *  - `settleAfterMs`: no read before then — a request the watchdog closed
 *    because its process stopped beating may still hold its gateway call
 *    open, and the gateway books a whole answer only when the vendor
 *    answers;
 *  - `floorCents`: the least to book — an answer that ended early, whose
 *    partial usage the gateway drops;
 *  - `expectedCents`: a finished answer's reported usage at the catalog
 *    price — a zero reading while this is above zero is not final until
 *    {@link ZERO_READING_GRACE_MS} after the op ended.
 */
export interface SpendHints {
  settleAfterMs: number | null;
  floorCents: number | null;
  expectedCents: number | null;
  /** When the op ended — the grace's start. */
  finalizedAtMs: number | null;
}

export interface SessionOpSettlementRow {
  organizationId: string;
  kind: string;
  mintedKeyId: string | null;
  finalized: boolean;
  spendSettled: boolean;
  keyRevoked: boolean;
  hints: SpendHints;
  startedAtMs: number;
  budgetCents: number | null;
  reservedTokens: number | null;
}

/**
 * The gateway's reading as the op's own facts qualify it: not read yet
 * while a whole answer may still be generating, raised to the floor a
 * broken-off answer counted, held back while a priced answer reads 0 inside
 * the grace (then the relay's figure), and a key the gateway lost booked at
 * what the relay saw rather than at nothing.
 */
export function adjustSpendReading(
  reading: GatewaySpendReading,
  hints: SpendHints,
  now: number = Date.now(),
): GatewaySpendReading {
  if (hints.settleAfterMs !== null && now < hints.settleAfterMs) {
    return { status: 'unavailable' };
  }
  const floor = hints.floorCents ?? 0;
  const expected = hints.expectedCents ?? 0;
  if (reading.status === 'gone') {
    const local = Math.max(floor, expected);
    return local > 0 ? { status: 'ok', cents: local } : reading;
  }
  if (reading.status !== 'ok') return reading;
  if (reading.cents === 0 && expected > 0) {
    const endedAt = hints.finalizedAtMs ?? now;
    if (now - endedAt < ZERO_READING_GRACE_MS) return { status: 'unavailable' };
    return { status: 'ok', cents: Math.max(expected, floor) };
  }
  if (floor > reading.cents) return { status: 'ok', cents: floor };
  return reading;
}

async function readSessionOpSettlement(
  sql: Sql | TransactionSql,
  args: { sessionId: string; execId: string },
): Promise<SessionOpSettlementRow | null> {
  const rows = await sql<
    {
      organizationId: string;
      kind: string;
      mintedKeyId: string | null;
      finalizedAt: number | null;
      spendSettledAt: number | null;
      keyRevokedAt: number | null;
      settleAfter: number | null;
      floorCents: number | null;
      expectedCents: number | null;
      startedAtMs: number;
      budgetCents: number | null;
      reservedTokens: number | null;
    }[]
  >`
    SELECT org_id AS "organizationId", kind,
           minted_key_id AS "mintedKeyId",
           finalized_at_ms::float8 AS "finalizedAt",
           spend_settled_at_ms::float8 AS "spendSettledAt",
           key_revoked_at_ms::float8 AS "keyRevokedAt",
           settle_after_ms::float8 AS "settleAfter",
           floor_cents::float8 AS "floorCents",
           expected_cents::float8 AS "expectedCents",
           started_at_ms::float8 AS "startedAtMs", budget_cents::float8 AS "budgetCents",
           reserved_tokens::float8 AS "reservedTokens"
    FROM app.sandbox_session_ops
    WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    organizationId: row.organizationId,
    kind: row.kind,
    startedAtMs: row.startedAtMs,
    budgetCents: row.budgetCents,
    reservedTokens: row.reservedTokens,
    mintedKeyId: row.mintedKeyId,
    finalized: row.finalizedAt !== null,
    spendSettled: row.spendSettledAt !== null,
    keyRevoked: row.keyRevokedAt !== null,
    hints: {
      settleAfterMs: row.settleAfter,
      floorCents: row.floorCents,
      expectedCents: row.expectedCents,
      finalizedAtMs: row.finalizedAt,
    },
  };
}

/**
 * Book a turn's spend: stamp the op row (`spent_cents`,
 * `spend_settled_at_ms`) and, in the same transaction, increment the org
 * usage ledger under the run's billing subject — the person (or the
 * automation sentinel) the run's starter names, the agent, and the API key
 * when a keyed door started it (`resolveSessionOpAttribution`). The stamp is
 * the idempotency gate — a replay (a burned finalize claim, a reconcile after
 * a partial attempt) finds the fact closed and books nothing twice. The
 * token counts are the caller's, else the ones the op row carries (a
 * model-endpoint request writes what its relay read when it ends, so the
 * reconcile job and the sweep book them too).
 */
export async function settleSessionOpSpend(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    /** `null` closes the fact without a figure (the key was gone before its
     * spend could be read). */
    spentCents: number | null;
    usage?: { inputTokens: number; outputTokens: number };
  },
): Promise<'settled' | 'already_settled' | 'missing'> {
  const now = Date.now();
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        organizationId: string;
        kind: string;
        modelRef: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
      }[]
    >`
      UPDATE app.sandbox_session_ops SET
        spent_cents = coalesce(${args.spentCents}::float8, spent_cents),
        spend_settled_at_ms = ${now}
      WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
        AND spend_settled_at_ms IS NULL
      RETURNING org_id AS "organizationId", kind, model_ref AS "modelRef",
        input_tokens::float8 AS "inputTokens",
        output_tokens::float8 AS "outputTokens"
    `;
    const op = rows[0];
    if (op === undefined) {
      const exists = await tx<{ id: string }[]>`
        SELECT id FROM app.sandbox_session_ops
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
        LIMIT 1
      `;
      return exists.length > 0 ? 'already_settled' : 'missing';
    }
    const usage = args.usage ?? {
      inputTokens: op.inputTokens ?? 0,
      outputTokens: op.outputTokens ?? 0,
    };
    const counted = usage.inputTokens > 0 || usage.outputTokens > 0;
    if (args.spentCents === null && !counted) return 'settled';
    const attributionArgs = {
      organizationId: op.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: op.kind,
    };
    const attribution = await withSessionOpBillingProjects(
      tx,
      attributionArgs,
      await resolveSessionOpAttribution(tx, attributionArgs),
    );
    if (attribution === null) {
      // The fact is closed either way (the figure is on the op row); what is
      // lost is the ledger attribution, which needs a run to charge.
      console.error(
        `[spend-settlement] op ${args.sessionId}/${args.execId} has no run to attribute its spend to — ${args.spentCents ?? 0} cents booked on the op row only`,
      );
      return 'settled';
    }
    const ref = op.modelRef !== null ? splitModelRef(op.modelRef) : null;
    await incrementUsageLedger(tx, {
      organizationId: op.organizationId,
      userId: attribution.userId,
      ...(attribution.apiKeyId !== undefined
        ? { apiKeyId: attribution.apiKeyId }
        : {}),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costEstimateCents: args.spentCents ?? 0,
      timestamp: now,
      ...(attribution.agentSlug !== undefined
        ? { agentSlug: attribution.agentSlug }
        : {}),
      ...(attribution.projectIds !== undefined
        ? { projectIds: attribution.projectIds }
        : {}),
      ...(ref !== null ? { model: ref.model, provider: ref.provider } : {}),
    });
    return 'settled';
  });
}

/** Stamp the revoke fact on the token row(s) carrying the key and on the op
 * that minted it. Only ever called once the gateway confirmed the delete
 * (or reported the key unknown). */
export async function markSessionOpKeyRevoked(
  sql: Sql | TransactionSql,
  args: { sessionId: string; keyId: string },
): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${now}
    WHERE session_id = ${args.sessionId}
      AND llm_gateway_key_id = ${args.keyId}
      AND revoked_at_ms IS NULL
  `;
  await sql`
    UPDATE app.sandbox_session_ops SET key_revoked_at_ms = ${now}
    WHERE session_id = ${args.sessionId}
      AND minted_key_id = ${args.keyId}
      AND key_revoked_at_ms IS NULL
  `;
}

/** The settlement port over `sql` + the gateway admin client — the reading
 * qualified by the op's own facts when it has any ({@link
 * adjustSpendReading}). */
export function pgGatewayKeySettlementPort(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    keyId: string;
    hints?: SpendHints;
  },
): GatewayKeySettlementPort {
  const hints = args.hints;
  return {
    readSpend: async () => {
      const reading = await readVirtualKeySpend(args.keyId);
      return hints === undefined ? reading : adjustSpendReading(reading, hints);
    },
    recordSpend: async (cents) => {
      await settleSessionOpSpend(sql, {
        sessionId: args.sessionId,
        execId: args.execId,
        spentCents: cents,
      });
    },
    revokeKey: () => revokeVirtualKey(args.keyId),
    markKeyRevoked: () =>
      markSessionOpKeyRevoked(sql, {
        sessionId: args.sessionId,
        keyId: args.keyId,
      }),
  };
}

/**
 * Finish one op's settlement from wherever it stopped. An op that never
 * minted a key (the subscription lane, a start that died before its mint)
 * has nothing to settle: its facts are closed so its reservation frees.
 */
export async function reconcileSessionOpKey(
  sql: Sql,
  args: { organizationId: string; sessionId: string; execId: string },
): Promise<GatewayKeySettlementOutcome | null> {
  const op = await readSessionOpSettlement(sql, args);
  if (op === null || op.organizationId !== args.organizationId) return null;
  if (op.kind === AUTOMATION_LLM_OP_KIND) {
    if (op.spendSettled) return { spendSettled: true, keyRevoked: true };
    const known = op.hints.expectedCents !== null;
    const deadline =
      op.hints.settleAfterMs ?? op.startedAtMs + AUTOMATION_LLM_LIFETIME_MS;
    if (!known && Date.now() < deadline)
      return { spendSettled: false, keyRevoked: true };
    const cents = known ? op.hints.expectedCents : op.budgetCents;
    if (
      cents === null ||
      !Number.isFinite(cents) ||
      cents < 0 ||
      (!known &&
        (op.reservedTokens === null ||
          !Number.isSafeInteger(op.reservedTokens) ||
          op.reservedTokens < 0))
    ) {
      throw new Error(
        'The direct LLM reservation has no valid settlement estimate',
      );
    }
    if (!known) {
      // A timeout/crash never proves zero spend. floor_cents marks the
      // reserved estimate; expected_cents remains NULL (not reported usage).
      const estimated = await sql<{ id: string }[]>`
        UPDATE app.sandbox_session_ops SET
          status = 'failed', finalized_at_ms = coalesce(finalized_at_ms, ${Date.now()}),
          finished_at_ms = coalesce(finished_at_ms, ${Date.now()}), floor_cents = budget_cents
        WHERE org_id = ${args.organizationId} AND session_id = ${args.sessionId}
          AND exec_id = ${args.execId} AND kind = ${AUTOMATION_LLM_OP_KIND}
          AND expected_cents IS NULL AND spend_settled_at_ms IS NULL
        RETURNING id
      `;
      // A reported completion or another settlement won the row lock.
      // Re-read its durable fact instead of replacing it with this estimate.
      if (!estimated[0]) return reconcileSessionOpKey(sql, args);
    }
    await settleSessionOpSpend(sql, {
      sessionId: args.sessionId,
      execId: args.execId,
      spentCents: cents,
      ...(!known
        ? { usage: { inputTokens: op.reservedTokens ?? 0, outputTokens: 0 } }
        : {}),
    });
    return { spendSettled: true, keyRevoked: true };
  }
  if (
    op.hints.settleAfterMs !== null &&
    Date.now() < op.hints.settleAfterMs &&
    op.mintedKeyId !== null
  ) {
    // Too early to read: the key stays, and a later attempt settles it.
    return { spendSettled: op.spendSettled, keyRevoked: op.keyRevoked };
  }
  if (op.mintedKeyId === null) {
    if (!op.spendSettled) {
      await sql`
        UPDATE app.sandbox_session_ops SET spend_settled_at_ms = ${Date.now()}
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
          AND spend_settled_at_ms IS NULL
      `;
    }
    return { spendSettled: true, keyRevoked: true };
  }
  const keyId = op.mintedKeyId;
  return settleGatewayKey(
    { spendSettled: op.spendSettled, keyRevoked: op.keyRevoked },
    pgGatewayKeySettlementPort(sql, {
      sessionId: args.sessionId,
      execId: args.execId,
      keyId,
      hints: op.hints,
    }),
    (message, error) =>
      console.warn(
        `[spend-settlement] ${args.sessionId}/${args.execId} key ${keyId}: ${message}`,
        ...(error !== undefined ? [error] : []),
      ),
  );
}

export interface ReconcileSweepResult {
  scanned: number;
  settled: number;
  pending: number;
}

/**
 * The sandbox watchdog's pass over finalized ops whose settlement is still
 * open past the grace: the backstop behind the host's own attempt and its
 * scheduled retries (a backend restart between them, a gateway down for
 * longer than the retry ladder). Oldest first, bounded, best-effort per op.
 */
export async function reconcilePendingSessionOpKeys(
  sql: Sql,
  options: { batch: number; now: number; minAgeMs?: number },
): Promise<ReconcileSweepResult> {
  const cutoff =
    options.now - (options.minAgeMs ?? GATEWAY_KEY_RECONCILE_MIN_AGE_MS);
  const candidates = await sql<
    { organizationId: string; sessionId: string; execId: string }[]
  >`
    SELECT org_id AS "organizationId", session_id AS "sessionId",
           exec_id AS "execId"
    FROM app.sandbox_session_ops
    WHERE ((finalized_at_ms IS NOT NULL AND finalized_at_ms < ${cutoff})
        OR (kind = ${AUTOMATION_LLM_OP_KIND} AND finalized_at_ms IS NULL
          AND started_at_ms <= ${options.now - AUTOMATION_LLM_LIFETIME_MS}))
      AND (spend_settled_at_ms IS NULL
        OR (minted_key_id IS NOT NULL AND key_revoked_at_ms IS NULL))
      AND (settle_after_ms IS NULL OR settle_after_ms <= ${options.now})
    ORDER BY finalized_at_ms ASC
    LIMIT ${options.batch}
  `;
  const result: ReconcileSweepResult = { scanned: 0, settled: 0, pending: 0 };
  for (const candidate of candidates) {
    result.scanned += 1;
    try {
      const outcome = await reconcileSessionOpKey(sql, candidate);
      if (outcome === null || !settlementPending(outcome)) result.settled += 1;
      else result.pending += 1;
    } catch (error) {
      result.pending += 1;
      console.error(
        `[spend-settlement] sweep could not settle ${candidate.sessionId}/${candidate.execId}:`,
        error,
      );
    }
  }
  return result;
}

/** The scheduled-ref name the hosts use for the settlement retry. */
const GATEWAY_KEY_RECONCILE_REF =
  'sandbox/gateway_reconcile:reconcileSessionOpKey';

/**
 * The ctx-shim scheduler mapping for the settlement retry, shared by the
 * task-agent and automation schedulers: true when `functionName` was the
 * reconcile ref and the job is enqueued, false for anything else.
 */
export async function scheduleGatewayKeyReconcile(
  sql: Sql,
  functionName: string,
  delayMs: number,
  args: unknown,
): Promise<boolean> {
  if (functionName !== GATEWAY_KEY_RECONCILE_REF) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the settle builds exactly the reconcile keys its handler re-validates
  const payload = args as {
    organizationId: string;
    sessionId: string;
    execId: string;
  };
  await addJobInTx(
    sql,
    'sandbox.gateway_key_reconcile',
    {
      organizationId: payload.organizationId,
      sessionId: payload.sessionId,
      execId: payload.execId,
    },
    delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {},
  );
  return true;
}
