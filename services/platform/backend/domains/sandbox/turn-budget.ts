import type { Sql } from 'postgres';

import type { ReserveTurnBudgetResult } from '../../core/node_only/sandbox/turn_budget.ts';
import {
  loadBudgetSubject,
  type OrgBudgetSubject,
  resolveTurnAllowance,
} from '../governance/budget-gate.ts';
import {
  lockBudgetAdmission,
  readInFlightReservations,
} from '../governance/budget-reservations.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import { resolveSessionOpAttribution } from './op-attribution.ts';

/**
 * Reserve a managed turn's gateway allowance under the org's spend cap —
 * the PG side of `sandbox/session_mutations:reserveTurnBudget`, taken by
 * both hosts right before they mint the turn's virtual key.
 *
 * Under the org admission lock and the budget-admission lock the chat lane's
 * opens share (so no two admissions read the same remaining balance): the
 * budget policy is evaluated for the run's starter against the ledger PLUS
 * what every other piece of work in flight holds — unsettled ops and live
 * chat turns alike — the allowance
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
    const subject: OrgBudgetSubject =
      userId === ''
        ? { organizationId: args.organizationId, userId, userTeamIds: [] }
        : await loadBudgetSubject(tx, {
            organizationId: args.organizationId,
            userId,
          });
    // The chat lane's opens take the same budget-admission lock and hold on
    // their generation rows: the allowance counts live chat turns as well
    // as the unsettled ops, and they count it.
    await lockBudgetAdmission(tx, args.organizationId);
    const allowance = await resolveTurnAllowance(tx, {
      ...subject,
      defaultCents,
      reservations: await readInFlightReservations(tx, subject, {
        op: { sessionId: args.sessionId, execId: args.execId },
      }),
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
