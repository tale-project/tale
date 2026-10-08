import type { Sql, TransactionSql } from 'postgres';

import { loadAttributedBudgetSubject } from '../governance/attributed-subject.ts';
import {
  resolveTurnAllowance,
  type TurnAllowance,
} from '../governance/budget-gate.ts';
import {
  lockBudgetAdmission,
  readInFlightReservations,
} from '../governance/budget-reservations.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import {
  resolveSessionOpAttribution,
  type SessionOpAttribution,
} from './op-attribution.ts';

/**
 * Reserve a managed turn's gateway allowance under the org's spend cap —
 * the PG side of `sandbox/session_mutations:reserveTurnBudget`, taken by
 * both hosts right before they mint the turn's virtual key, and by the model
 * endpoints for API keys before each request's key (`kind: 'model-api'`,
 * its subject named by the caller).
 *
 * Under the org admission lock and the budget-admission lock the chat lane's
 * opens share (so no two admissions read the same remaining balance; a
 * model-endpoint request takes the budget-admission lock alone — it admits
 * no sandbox, so the sandbox admission lock would only queue it behind
 * session starts): the
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
    /** `model-api`: one request through the model endpoints for API keys
     * (`domains/model_api`), which has no run behind it and names its
     * subject itself. `direct-call`: one call the platform makes straight
     * to a provider (`domains/governance/direct-calls.ts`), which names its
     * subject too. */
    kind: 'task-agent' | 'workflow-agent' | 'model-api' | 'direct-call';
    defaultBudgetCents: number;
    modelRef?: string;
    /** The harness this turn runs on — the op row's own record, which the
     * harness-turn metrics read ahead of the session's create-time stamp. */
    harness?: string;
    /** The billing subject, when the caller authenticated it and there is
     * no run to derive it from — the model endpoints' key holder, under
     * `__direct_api__`, with the key. Stamped on the op row, where the
     * settlement's attribution finds it (`resolveSessionOpAttribution`). */
    subject?: SessionOpAttribution;
    /** Admit the default whole or not at all, with this many tokens: the
     * model endpoints' hold is the request's worst case, never a budget to
     * shrink to what remains (`resolveTurnAllowance`'s `whole`). The tokens
     * are also recorded on the row, where the in-flight holds count them
     * against token caps. */
    whole?: { prospectiveTokens: number };
    /** At most this many requests of the subject — and, separately, of its
     * API key — may be running in the organization at once; one more is
     * refused before anything is held. */
    concurrencyLimit?: number;
    /** When the hold lapses if nothing settles it — a direct call's process
     * may die mid-call, and the watchdog releases its hold past this. */
    deadlineAtMs?: number;
  },
): Promise<TurnAllowance> {
  const defaultCents = Math.max(1, Math.floor(args.defaultBudgetCents));
  return sql.begin(async (tx) => {
    // Only a managed turn admits a sandbox; a request with no run behind
    // it takes the budget-admission lock alone.
    if (args.kind === 'task-agent' || args.kind === 'workflow-agent') {
      await lockOrgAdmission(tx, args.organizationId);
    }
    const attribution =
      args.subject ?? (await resolveSessionOpAttribution(tx, args));
    const userId = attribution?.userId ?? '';
    // Nobody to measure — an op without a run to attribute, or a run a
    // trigger started — is evaluated against the organization's caps (and
    // the key's, were one involved) alone; a person is measured as they are
    // now, teams and role included. The projects the run is in bind the
    // turn either way: a trigger's run spends their budgets all the same.
    const subject = await loadAttributedBudgetSubject(
      tx,
      args.organizationId,
      attribution,
    );
    // The chat lane's opens take the same budget-admission lock and hold on
    // their generation rows: the allowance counts live chat turns as well
    // as the unsettled ops, and they count it.
    await lockBudgetAdmission(tx, args.organizationId);
    if (args.concurrencyLimit !== undefined && userId !== '') {
      const busy = await runningRequestsOf(tx, {
        organizationId: args.organizationId,
        kind: args.kind,
        userId,
        apiKeyId: attribution?.apiKeyId,
      });
      const scope =
        busy.apiKey >= args.concurrencyLimit
          ? 'apiKey'
          : busy.user >= args.concurrencyLimit
            ? 'user'
            : undefined;
      if (scope !== undefined) {
        return {
          allowed: false,
          reason: `${scope === 'apiKey' ? 'This API key already has' : 'You already have'} ${args.concurrencyLimit} requests running; wait for one to finish.`,
          concurrency: {
            scope,
            running: scope === 'apiKey' ? busy.apiKey : busy.user,
            limit: args.concurrencyLimit,
          },
        };
      }
    }
    const allowance = await resolveTurnAllowance(tx, {
      ...subject,
      defaultCents,
      reservations: await readInFlightReservations(tx, subject, {
        op: { sessionId: args.sessionId, execId: args.execId },
      }),
      ...(args.whole !== undefined ? { whole: args.whole } : {}),
    });
    if (!allowance.allowed) return allowance;
    const now = Date.now();
    await tx`
      INSERT INTO app.sandbox_session_ops (
        org_id, session_id, exec_id, kind, status, user_id, agent_slug,
        api_key_id, project_ids, model_ref, harness, budget_cents,
        reserved_tokens, deadline_ms, heartbeat_at_ms, started_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.sessionId}, ${args.execId},
        ${args.kind}, 'running',
        ${userId === '' ? null : userId},
        ${attribution?.agentSlug ?? null}, ${attribution?.apiKeyId ?? null},
        ${subject.projectIds !== undefined ? [...subject.projectIds] : null},
        ${args.modelRef ?? null}, ${args.harness ?? null},
        ${allowance.budgetCents}, ${args.whole?.prospectiveTokens ?? null},
        ${args.deadlineAtMs ?? null}, ${now}, ${now}
      )
      ON CONFLICT (session_id, exec_id) DO UPDATE SET
        budget_cents = EXCLUDED.budget_cents,
        user_id = coalesce(app.sandbox_session_ops.user_id, EXCLUDED.user_id),
        agent_slug = coalesce(app.sandbox_session_ops.agent_slug,
          EXCLUDED.agent_slug),
        api_key_id = coalesce(app.sandbox_session_ops.api_key_id,
          EXCLUDED.api_key_id),
        project_ids = coalesce(app.sandbox_session_ops.project_ids,
          EXCLUDED.project_ids),
        model_ref = coalesce(EXCLUDED.model_ref,
          app.sandbox_session_ops.model_ref),
        harness = coalesce(EXCLUDED.harness, app.sandbox_session_ops.harness)
    `;
    return allowance;
  });
}

/** How many requests of `kind` the subject — and, separately, its API key —
 * have running in the organization right now. Read under the
 * budget-admission lock, so two admissions never count the same slot. */
async function runningRequestsOf(
  tx: TransactionSql,
  args: {
    organizationId: string;
    kind: string;
    userId: string;
    apiKeyId: string | undefined;
  },
): Promise<{ user: number; apiKey: number }> {
  const rows = await tx<{ user: number; apiKey: number }[]>`
    SELECT
      count(*) FILTER (WHERE user_id = ${args.userId})::int AS "user",
      count(*) FILTER (WHERE api_key_id = ${args.apiKeyId ?? null})::int
        AS "apiKey"
    FROM app.sandbox_session_ops
    WHERE org_id = ${args.organizationId} AND kind = ${args.kind}
      AND status = 'running'
  `;
  return { user: rows[0]?.user ?? 0, apiKey: rows[0]?.apiKey ?? 0 };
}
