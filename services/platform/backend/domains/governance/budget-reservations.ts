import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { TTS_PENDING_STALE_MS } from '../../../lib/shared/constants/tts.ts';
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
 * (`app.sandbox_session_ops`), and while one of its `generate_image` calls
 * runs, that call's estimate and image requests on top; a call the platform
 * makes straight to a provider (an automation's `llm` step, a chat title,
 * the Inbox's Improve — `direct-calls.ts`) holds its worst case on an op
 * row of its own until it is booked; a voice output chunk holds its
 * estimate on its pending row (`app.tts_audio_chunks`). An admission adds
 * every other hold to the booked usage under the organization's admission
 * lock, so the holds it reads cannot change until its own is written.
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
  projects:
    | {
        projectId: string;
        costCents: number;
        tokens: number;
        requests: number;
      }[]
    | null;
}

/**
 * What every other piece of work in flight holds, per bucket the subject is
 * measured in: the organization's, the subject's own, each of their teams'
 * (the holds of that team's CURRENT members and of the keys it owns, as the
 * team's usage is read), the authenticating API key's — a keyed chat turn's, a keyed run's
 * managed turn and a model-endpoint request alike, each op row carrying the
 * key its reservation stamped, and, for a key that is not a person, every
 * hold of its identity — and each of the subject's projects': a chat turn
 * in one of its threads, and every op row its reservation stamped with it
 * (an automation run's op, with every project the run belongs to). A chat
 * turn's hold, a managed turn's
 * allowance, a model-endpoint request, a direct call and a pending voice
 * chunk count as one request each; an image generation in flight counts one
 * per image it may make. Costs count as reserved, tokens where the work
 * sized them (a chat turn's round, a model-endpoint request's or a direct
 * call's prompt and output cap; an agent turn and a voice chunk hold no
 * token figure). `exclude` leaves out the admission's own row when it
 * already exists.
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
  // A key that is not a person: everything its identity holds is the key's.
  const keyIdentity = subject.apiKeyIdentity ?? null;
  const projectIds = [...(subject.projectIds ?? [])];
  const rows = await sql<HoldRow[]>`
    WITH holds AS (
      -- A chat turn belongs to its thread's project.
      SELECT g.user_id, g.api_key_id,
             CASE WHEN tm.project_id IS NULL THEN '{}'::text[]
                  ELSE ARRAY[tm.project_id] END AS project_ids,
             g.reserved_cost_cents::float8 AS cost_cents,
             g.reserved_tokens::float8 AS tokens,
             1::float8 AS requests
      FROM app.generations g
      LEFT JOIN app.thread_metadata tm ON tm.thread_id = g.thread_id
      WHERE g.org_id = ${org} AND g.user_id IS NOT NULL
        AND g.thread_id <> ${exclude.threadId ?? ''}
      UNION ALL
      -- A managed turn or a model-endpoint request: its gateway allowance
      -- (a subscription turn has none) and the tokens its hold sized, plus
      -- the image generation it has in flight — in the projects its
      -- reservation stamped.
      SELECT user_id, api_key_id, coalesce(project_ids, '{}'::text[]),
             (coalesce(budget_cents, 0) + image_hold_cents)::float8,
             coalesce(reserved_tokens, 0)::float8,
             ((CASE WHEN budget_cents IS NULL THEN 0 ELSE 1 END)
               + image_hold_requests)::float8
      FROM app.sandbox_session_ops
      WHERE org_id = ${org}
        AND (budget_cents IS NOT NULL OR image_call_started_at_ms IS NOT NULL)
        AND spend_settled_at_ms IS NULL
        AND NOT (session_id = ${exclude.op?.sessionId ?? ''}
                 AND exec_id = ${exclude.op?.execId ?? ''})
      UNION ALL
      -- A voice output chunk being made: its estimate, toward its requester
      -- and the project of the thread it reads aloud, while it is pending —
      -- until it turns ready (and is booked) or failed, or its attempt goes
      -- stale with its process.
      SELECT c.user_id, NULL::text,
             CASE WHEN tm.project_id IS NULL THEN '{}'::text[]
                  ELSE ARRAY[tm.project_id] END,
             c.reserved_cost_cents::float8, 0::float8, 1::float8
      FROM app.tts_audio_chunks c
      LEFT JOIN app.thread_metadata tm ON tm.thread_id = c.thread_id
      WHERE c.org_id = ${org} AND c.status = 'pending'
        AND c.reserved_cost_cents IS NOT NULL
        AND c.attempt_created_at_ms > ${Date.now() - TTS_PENDING_STALE_MS}
    ),
    -- Who spends for a team: its current members, and the keys it owns.
    team_spenders AS (
      SELECT tm."userId" AS user_id, tm."teamId" AS team_id
      FROM "teamMember" tm
      JOIN "team" t ON t."id" = tm."teamId" AND t."organizationId" = ${org}
      WHERE tm."teamId" = ANY(${subject.userTeamIds}::text[])
      UNION ALL
      SELECT o.principal_user_id, o.team_id
      FROM app.api_key_owners o
      WHERE o.org_id = ${org} AND o.owner_kind = 'team'
        AND o.team_id = ANY(${subject.userTeamIds}::text[])
    ),
    team_holds AS (
      SELECT ts.team_id AS "teamId",
             sum(h.cost_cents)::float8 AS "costCents",
             sum(h.tokens)::float8 AS "tokens",
             sum(h.requests)::float8 AS "requests"
      FROM holds h
      JOIN team_spenders ts ON ts.user_id = h.user_id
      GROUP BY ts.team_id
    ),
    -- A hold in several projects counts toward each of them.
    project_holds AS (
      SELECT p.project_id AS "projectId",
             sum(h.cost_cents)::float8 AS "costCents",
             sum(h.tokens)::float8 AS "tokens",
             sum(h.requests)::float8 AS "requests"
      FROM holds h
      CROSS JOIN LATERAL unnest(h.project_ids) AS p(project_id)
      WHERE p.project_id = ANY(${projectIds}::text[])
      GROUP BY p.project_id
    )
    SELECT
      coalesce(sum(cost_cents), 0)::float8 AS "orgCostCents",
      coalesce(sum(tokens), 0)::float8 AS "orgTokens",
      coalesce(sum(requests), 0)::float8 AS "orgRequests",
      coalesce(sum(cost_cents) FILTER (WHERE user_id = ${subject.userId}), 0)::float8
        AS "userCostCents",
      coalesce(sum(tokens) FILTER (WHERE user_id = ${subject.userId}), 0)::float8
        AS "userTokens",
      coalesce(sum(requests) FILTER (WHERE user_id = ${subject.userId}), 0)::float8
        AS "userRequests",
      coalesce(sum(cost_cents) FILTER (
        WHERE api_key_id = ${apiKeyId} OR user_id = ${keyIdentity}), 0)::float8
        AS "keyCostCents",
      coalesce(sum(tokens) FILTER (
        WHERE api_key_id = ${apiKeyId} OR user_id = ${keyIdentity}), 0)::float8
        AS "keyTokens",
      coalesce(sum(requests) FILTER (
        WHERE api_key_id = ${apiKeyId} OR user_id = ${keyIdentity}), 0)::float8
        AS "keyRequests",
      (SELECT json_agg(team_holds) FROM team_holds) AS "teams",
      (SELECT json_agg(project_holds) FROM project_holds) AS "projects"
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
    ...(projectIds.length > 0
      ? {
          projects: Object.fromEntries(
            (row?.projects ?? []).map((project) => [
              project.projectId,
              hold(project.costCents, project.tokens, project.requests),
            ]),
          ),
        }
      : {}),
    teams: Object.fromEntries(
      (row?.teams ?? []).map((team) => [
        team.teamId,
        hold(team.costCents, team.tokens, team.requests),
      ]),
    ),
  };
}
