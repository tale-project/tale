import type { Sql, TransactionSql } from 'postgres';

import {
  type GatewayKeySettlementOutcome,
  type GatewayKeySettlementPort,
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
export const GATEWAY_KEY_RECONCILE_MIN_AGE_MS = 2 * 60_000;

export interface SessionOpSettlementRow {
  organizationId: string;
  kind: string;
  mintedKeyId: string | null;
  finalized: boolean;
  spendSettled: boolean;
  keyRevoked: boolean;
}

export async function readSessionOpSettlement(
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
    }[]
  >`
    SELECT org_id AS "organizationId", kind,
           minted_key_id AS "mintedKeyId",
           finalized_at_ms::float8 AS "finalizedAt",
           spend_settled_at_ms::float8 AS "spendSettledAt",
           key_revoked_at_ms::float8 AS "keyRevokedAt"
    FROM app.sandbox_session_ops
    WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    organizationId: row.organizationId,
    kind: row.kind,
    mintedKeyId: row.mintedKeyId,
    finalized: row.finalizedAt !== null,
    spendSettled: row.spendSettledAt !== null,
    keyRevoked: row.keyRevokedAt !== null,
  };
}

/**
 * Book a turn's spend: stamp the op row (`spent_cents`,
 * `spend_settled_at_ms`) and, in the same transaction, increment the org
 * usage ledger under the run's starter and agent. The stamp is the
 * idempotency gate — a replay (a burned finalize claim, a reconcile after a
 * partial attempt) finds the fact closed and books nothing twice.
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
      }[]
    >`
      UPDATE app.sandbox_session_ops SET
        spent_cents = coalesce(${args.spentCents}::float8, spent_cents),
        spend_settled_at_ms = ${now}
      WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
        AND spend_settled_at_ms IS NULL
      RETURNING org_id AS "organizationId", kind, model_ref AS "modelRef"
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
    if (args.spentCents === null && args.usage === undefined) return 'settled';
    const attribution = await resolveSessionOpAttribution(tx, {
      organizationId: op.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: op.kind,
    });
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
      inputTokens: args.usage?.inputTokens ?? 0,
      outputTokens: args.usage?.outputTokens ?? 0,
      costEstimateCents: args.spentCents ?? 0,
      timestamp: now,
      ...(attribution.agentSlug !== undefined
        ? { agentSlug: attribution.agentSlug }
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

/** The settlement port over `sql` + the gateway admin client. */
export function pgGatewayKeySettlementPort(
  sql: Sql,
  args: { sessionId: string; execId: string; keyId: string },
): GatewayKeySettlementPort {
  return {
    readSpend: () => readVirtualKeySpend(args.keyId),
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
    WHERE finalized_at_ms IS NOT NULL AND finalized_at_ms < ${cutoff}
      AND (spend_settled_at_ms IS NULL
        OR (minted_key_id IS NOT NULL AND key_revoked_at_ms IS NULL))
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
export const GATEWAY_KEY_RECONCILE_REF =
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
