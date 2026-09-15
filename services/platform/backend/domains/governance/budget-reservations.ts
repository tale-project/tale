import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import type {
  BudgetReservations,
  OrgBudgetSubject,
  ReservedSpend,
} from './budget-gate.ts';

/**
 * What the work still in flight holds against the budget caps, and the lock
 * every budget admission takes before it reads that.
 *
 * Usage is booked when work settles, so a cap measured against the booked
 * usage alone lets every request racing it through. A live chat turn holds
 * its first round's worst case on its generation row (`app.generations`,
 * gone when the turn settles or the watchdog clears it); a managed turn
 * holds its gateway allowance on its op row until its spend is booked
 * (`app.sandbox_session_ops`). An admission adds every other hold to the
 * booked usage under the organization's admission lock, so the holds it
 * reads cannot change until its own is written.
 */

/** The retry-queue key the organization's budget admissions share. */
export function budgetAdmissionQueueKey(organizationId: string): string {
  return `budget-admission:${organizationId}`;
}

/**
 * Take the organization's budget-admission lock: the transaction-level
 * advisory lock on the retry-queue key, then the admission row, bumped.
 *
 * The row does the serializing. Under READ COMMITTED its lock queues the
 * admissions, and the next statement sees the hold the previous admission
 * wrote. A SERIALIZABLE transaction (the REST lane's open) fixes its
 * snapshot at its first statement, so an admission committed in between
 * would be invisible to it: the bump turns that into a 40001 at this upsert,
 * marked with the queue key so `transactSerializable` retries holding the
 * key as a session lock from before its BEGIN — the audit chain head's
 * pattern. Take it before the locks of the rows the admission goes on to
 * write (a thread's claim), so every admission acquires them in one order.
 */
export async function lockBudgetAdmission(
  tx: Sql | TransactionSql,
  organizationId: string,
): Promise<void> {
  const queueKey = budgetAdmissionQueueKey(organizationId);
  try {
    await tx`
      SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${queueKey}))
    `;
    await tx`
      INSERT INTO app.budget_admissions (org_id, admitted_at_ms)
      VALUES (${organizationId}, ${Date.now()})
      ON CONFLICT (org_id) DO UPDATE SET admitted_at_ms = EXCLUDED.admitted_at_ms
    `;
  } catch (error) {
    throw markRetryQueueKey(error, queueKey);
  }
}

interface HoldRow {
  orgCostCents: number;
  orgTokens: number;
  orgRequests: number;
  userCostCents: number;
  userTokens: number;
  userRequests: number;
  keyCostCents: number;
  keyTokens: number;
  keyRequests: number;
  teams:
    | {
        teamId: string;
        costCents: number;
        tokens: number;
        requests: number;
      }[]
    | null;
}

/**
 * What every other piece of work in flight holds, per bucket the subject is
 * measured in: the organization's, the subject's own, each of their teams'
 * (the holds of that team's CURRENT members, as the team's usage is read)
 * and the authenticating API key's. A hold counts as one request. `exclude`
 * leaves out the admission's own row when it already exists.
 */
export async function readInFlightReservations(
  sql: Sql | TransactionSql,
  subject: OrgBudgetSubject,
  exclude: {
    threadId?: string;
    op?: { sessionId: string; execId: string };
  } = {},
): Promise<BudgetReservations> {
  const org = subject.organizationId;
  const apiKeyId = subject.apiKeyId ?? null;
  const rows = await sql<HoldRow[]>`
    WITH holds AS (
      SELECT user_id, api_key_id,
             reserved_cost_cents::float8 AS cost_cents,
             reserved_tokens::float8 AS tokens
      FROM app.generations
      WHERE org_id = ${org} AND user_id IS NOT NULL
        AND thread_id <> ${exclude.threadId ?? ''}
      UNION ALL
      SELECT user_id, NULL, budget_cents::float8, 0::float8
      FROM app.sandbox_session_ops
      WHERE org_id = ${org} AND budget_cents IS NOT NULL
        AND spend_settled_at_ms IS NULL
        AND NOT (session_id = ${exclude.op?.sessionId ?? ''}
                 AND exec_id = ${exclude.op?.execId ?? ''})
    ),
    team_holds AS (
      SELECT tm."teamId" AS "teamId",
             sum(h.cost_cents)::float8 AS "costCents",
             sum(h.tokens)::float8 AS "tokens",
             count(*)::float8 AS "requests"
      FROM holds h
      JOIN "teamMember" tm ON tm."userId" = h.user_id
      JOIN "team" t ON t."id" = tm."teamId" AND t."organizationId" = ${org}
      WHERE tm."teamId" = ANY(${subject.userTeamIds}::text[])
      GROUP BY tm."teamId"
    )
    SELECT
      coalesce(sum(cost_cents), 0)::float8 AS "orgCostCents",
      coalesce(sum(tokens), 0)::float8 AS "orgTokens",
      count(*)::float8 AS "orgRequests",
      coalesce(sum(cost_cents) FILTER (WHERE user_id = ${subject.userId}), 0)::float8
        AS "userCostCents",
      coalesce(sum(tokens) FILTER (WHERE user_id = ${subject.userId}), 0)::float8
        AS "userTokens",
      count(*) FILTER (WHERE user_id = ${subject.userId})::float8 AS "userRequests",
      coalesce(sum(cost_cents) FILTER (WHERE api_key_id = ${apiKeyId}), 0)::float8
        AS "keyCostCents",
      coalesce(sum(tokens) FILTER (WHERE api_key_id = ${apiKeyId}), 0)::float8
        AS "keyTokens",
      count(*) FILTER (WHERE api_key_id = ${apiKeyId})::float8 AS "keyRequests",
      (SELECT json_agg(team_holds) FROM team_holds) AS "teams"
    FROM holds
  `;
  const row = rows[0];
  const hold = (costCents = 0, tokens = 0, requests = 0): ReservedSpend => ({
    costCents,
    tokens,
    requests,
  });
  return {
    org: hold(row?.orgCostCents, row?.orgTokens, row?.orgRequests),
    user: hold(row?.userCostCents, row?.userTokens, row?.userRequests),
    ...(subject.apiKeyId !== undefined
      ? { apiKey: hold(row?.keyCostCents, row?.keyTokens, row?.keyRequests) }
      : {}),
    teams: Object.fromEntries(
      (row?.teams ?? []).map((team) => [
        team.teamId,
        hold(team.costCents, team.tokens, team.requests),
      ]),
    ),
  };
}
