import type { Sql } from 'postgres';

import { getUserTeamIds } from '../../auth/membership.ts';
import type { ReserveTurnBudgetResult } from '../../core/node_only/sandbox/turn_budget.ts';
import { resolveTurnAllowance } from '../governance/budget-gate.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import { resolveSessionOpAttribution } from './op-attribution.ts';

/**
 * Reserve a managed turn's gateway allowance under the org's spend cap —
 * the PG side of `sandbox/session_mutations:reserveTurnBudget`, taken by
 * both hosts right before they mint the turn's virtual key.
 *
 * Under the org admission lock (so two starts cannot both read the same
 * remaining balance): the budget policy is evaluated for the run's starter
 * against the ledger PLUS every unsettled op's reservation, the allowance
 * is `min(deployment default, what remains)`, and this op's reservation is
 * recorded on its row — where it counts until the turn's spend is booked
 * (`spend_settled_at_ms`), whether the turn ends normally, crashes, or never
 * mints at all. A refusal records nothing: the start fails visibly with the
 * cap's own wording.
 */
export async function reserveTurnBudget(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    kind: 'task-agent' | 'workflow-agent';
    defaultBudgetCents: number;
    modelRef?: string;
  },
): Promise<ReserveTurnBudgetResult> {
  const defaultCents = Math.max(1, Math.floor(args.defaultBudgetCents));
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const attribution = await resolveSessionOpAttribution(tx, args);
    const userId = attribution?.userId ?? '';
    const [userTeamIds, role] =
      userId === ''
        ? [[] as string[], undefined]
        : await Promise.all([
            getUserTeamIds(tx, args.organizationId, userId),
            tx<{ role: string }[]>`
              SELECT "role" FROM "member"
              WHERE "userId" = ${userId}
                AND "organizationId" = ${args.organizationId}
              LIMIT 1
            `.then((rows) => rows[0]?.role),
          ]);
    const reserved = await tx<{ orgCents: number; userCents: number }[]>`
      SELECT coalesce(sum(budget_cents), 0)::float8 AS "orgCents",
             coalesce(sum(budget_cents) FILTER (WHERE user_id = ${userId}), 0)::float8
               AS "userCents"
      FROM app.sandbox_session_ops
      WHERE org_id = ${args.organizationId}
        AND budget_cents IS NOT NULL AND spend_settled_at_ms IS NULL
        AND NOT (session_id = ${args.sessionId} AND exec_id = ${args.execId})
    `;
    const allowance = await resolveTurnAllowance(tx, {
      organizationId: args.organizationId,
      userId,
      userTeamIds,
      ...(role !== undefined ? { userRole: role } : {}),
      defaultCents,
      reserved: {
        orgCents: reserved[0]?.orgCents ?? 0,
        userCents: reserved[0]?.userCents ?? 0,
      },
    });
    if (!allowance.allowed) return allowance;
    const now = Date.now();
    await tx`
      INSERT INTO app.sandbox_session_ops (
        org_id, session_id, exec_id, kind, status, user_id, agent_slug,
        model_ref, budget_cents, heartbeat_at_ms, started_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.sessionId}, ${args.execId},
        ${args.kind}, 'running',
        ${userId === '' ? null : userId},
        ${attribution?.agentSlug ?? null}, ${args.modelRef ?? null},
        ${allowance.budgetCents}, ${now}, ${now}
      )
      ON CONFLICT (session_id, exec_id) DO UPDATE SET
        budget_cents = EXCLUDED.budget_cents,
        user_id = coalesce(app.sandbox_session_ops.user_id, EXCLUDED.user_id),
        agent_slug = coalesce(app.sandbox_session_ops.agent_slug,
          EXCLUDED.agent_slug),
        model_ref = coalesce(EXCLUDED.model_ref,
          app.sandbox_session_ops.model_ref)
    `;
    return allowance;
  });
}
