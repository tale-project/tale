import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  sandboxCapacity,
  sessionCancelExec,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  DEFAULT_SANDBOX_QUOTA,
  sessionBudgetForOwnerType,
  sessionCapFor,
  type SessionBudget,
} from '../../core/sandbox/quota_policy.ts';
import { SANDBOX_AGENT_OP_KINDS } from '../../core/sandbox/session_constants.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { canReadRun } from '../automations/project-visibility.ts';
import { getRun } from '../automations/store.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  scheduleSessionDestroy,
  sessionDestroyStates,
} from './destroy-schedule.ts';
import {
  classifyOutcome,
  NO_OUTCOME_RESULT_STATUSES,
} from './external-turn-outcome.ts';
import { getSandboxDeploymentLimits } from './limits.ts';
import { pinSession } from './service.ts';
import {
  getAgentNodeSandboxOp,
  listRunningOpsBySession,
  listSandboxViewsForOrg,
} from './sessions.ts';
import { reconcileOrgSessions } from './watchdogs.ts';
import { unusedWorkspaceDeletions } from './workspace-cleanup.ts';

/** The most settled agent ops the external-turn metrics read folds. */
const EXTERNAL_TURN_METRICS_ROW_CAP = 5000;

/**
 * /api/app/sandbox — the sandbox-management surface: the org's live
 * sessions (with their running ops), always-on pinning, and explicit
 * teardown. Developers can inspect aggregate capacity and quota; workspace
 * details and changes require the `orgSettings` write capability because
 * the organization-wide list can include private projects.
 */

const pinSchema = z.object({ pinned: z.boolean() });

function hasAdminCapability(c: Context<OrgEnv>): boolean {
  return defineAbilityFor(c.get('orgMember').role).can('write', 'orgSettings');
}

function requireAdmin(c: Context<OrgEnv>): Response | null {
  return hasAdminCapability(c)
    ? null
    : c.json({ error: 'admin capability required' }, 403);
}

function requireComputeReader(c: Context<OrgEnv>): Response | null {
  return isAdminOrDeveloperRole(c.get('orgMember').role)
    ? null
    : c.json({ error: 'developer role required' }, 403);
}

export function createSandboxRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/limits', async (c) => {
    const denied = requireComputeReader(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json(await getSandboxDeploymentLimits(c.get('orgId')));
  });

  /** Aggregate hardware/runtime observations, separate from organization
   * policy. Only administrators and developers see host aggregates; no other org's ids are
   * returned. Failure is explicit, so a down spawner never looks empty. */
  app.get('/capacity', async (c) => {
    const denied = requireComputeReader(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    if (!process.env.SANDBOX_TOKEN?.trim()) {
      return c.json({ status: 'unavailable', reason: 'not_configured' });
    }
    try {
      const snapshot = await sandboxCapacity(c.get('orgId'));
      return c.json({
        ...snapshot,
        // Developers can see aggregate infrastructure pressure without
        // learning ids belonging to a project they cannot access.
        runtimeSessions: hasAdminCapability(c) ? snapshot.runtimeSessions : [],
      });
    } catch (error) {
      console.warn(
        '[sandbox] capacity observation unavailable:',
        error instanceof Error ? error.message : 'unknown failure',
      );
      return c.json({ status: 'unavailable', reason: 'unreachable' });
    }
  });

  /** Per-budget quota pressure (the 0.4 `getSandboxQuotaUsage` wire). */
  app.get('/quota-usage', async (c) => {
    const denied = requireComputeReader(c);
    if (denied) return denied;
    const organizationId = c.get('orgId');
    const policy = await readGovernancePolicyForOrg(
      deps.sql,
      organizationId,
      'sandbox_quota',
    );
    const quota = policy ?? DEFAULT_SANDBOX_QUOTA;
    const rows = await deps.sql<{ ownerType: string; count: string }[]>`
      SELECT owner_type AS "ownerType", count(*)::text AS count
      FROM app.sandbox_sessions
      WHERE org_id = ${organizationId} AND status IN ('creating', 'active')
      GROUP BY owner_type
    `;
    const used: Record<SessionBudget, number> = {
      project: 0,
      workflow: 0,
      render: 0,
    };
    for (const row of rows) {
      const budget = sessionBudgetForOwnerType(row.ownerType);
      if (budget !== null) used[budget] += Number(row.count);
    }
    const budgets: SessionBudget[] = ['project', 'workflow', 'render'];
    return c.json({
      usage: budgets.map((budget) => {
        const cap = sessionCapFor(budget, quota);
        const u = used[budget];
        return {
          budget,
          used: u,
          cap,
          atLimit: u >= cap,
          nearLimit: cap > 0 && u / cap >= 0.8,
        };
      }),
    });
  });

  /** External-turn KPIs for the Harness-turns metrics page (the 0.4
   * `getExternalTurnMetrics` fold over settled agent ops; outcome =
   * agent_result_status with the op status as fallback, recovered =
   * a continued turn). A turn is named by the harness its op row records —
   * the session's `agent_kind` is a create-time stamp a standing session
   * keeps across the agent's harness switches, so it is only the fallback
   * for rows written before the op carried its own. Session ids may have
   * several incarnations: the fallback reads one latest row in this tenant.
   * An op whose start failed before a session existed still counts.
   * Developer-gated like the 0.4 read. */
  app.get('/external-turn-metrics', async (c) => {
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json({ error: 'developer role required' }, 403);
    }
    const periodRaw = Number(c.req.query('periodDays') ?? '7');
    const periodDays = Number.isFinite(periodRaw)
      ? Math.min(Math.max(1, periodRaw), 90)
      : 7;
    const since = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    const rows = await deps.sql<
      {
        outcome: string | null;
        status: string;
        harness: string | null;
        durationMs: number;
        spentCents: number | null;
        recovered: boolean;
      }[]
    >`
      SELECT o.agent_result_status AS outcome, o.status,
             coalesce(o.harness, s.agent_kind) AS harness,
             (o.finished_at_ms - o.started_at_ms)::float8 AS "durationMs",
             o.spent_cents AS "spentCents",
             coalesce(o.continuation_count, 0) > 0 AS recovered
      FROM app.sandbox_session_ops o
      LEFT JOIN LATERAL (
        SELECT agent_kind FROM app.sandbox_sessions
        WHERE org_id = o.org_id AND session_id = o.session_id
          AND o.harness IS NULL
        ORDER BY created_at_ms DESC, id DESC
        LIMIT 1
      ) s ON true
      WHERE o.org_id = ${c.get('orgId')}
        AND o.kind = ANY(${[...SANDBOX_AGENT_OP_KINDS]})
        AND o.finished_at_ms IS NOT NULL
        AND o.started_at_ms >= ${since}
        -- Not an outcome (parked on a question, waiting for room): left
        -- out before the cap, which their volume would otherwise fill.
        AND (o.agent_result_status IS NULL
          OR o.agent_result_status <> ALL(${[...NO_OUTCOME_RESULT_STATUSES]}))
      ORDER BY o.started_at_ms DESC
      LIMIT ${EXTERNAL_TURN_METRICS_ROW_CAP}
    `;
    let total = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let timeout = 0;
    let recovered = 0;
    let spentCents = 0;
    const durations: number[] = [];
    const byHarness = new Map<
      string,
      { total: number; completed: number; failed: number; timeout: number }
    >();
    for (const row of rows) {
      // ONE classification for the summary and the per-harness row, so the
      // cards equal the table (a harness `error` or `max-turns` is a failed
      // turn in both; a turn parked on a question is in neither).
      const outcome = classifyOutcome(row.outcome, row.status);
      if (outcome === 'parked') continue;
      total += 1;
      durations.push(row.durationMs);
      if (row.spentCents !== null) spentCents += row.spentCents;
      if (row.recovered) recovered += 1;
      if (outcome === 'completed') completed += 1;
      else if (outcome === 'failed') failed += 1;
      else if (outcome === 'cancelled') cancelled += 1;
      else timeout += 1;
      const harness = row.harness ?? 'unknown';
      const bucket = byHarness.get(harness) ?? {
        total: 0,
        completed: 0,
        failed: 0,
        timeout: 0,
      };
      bucket.total += 1;
      if (outcome === 'completed') bucket.completed += 1;
      else if (outcome === 'failed') bucket.failed += 1;
      else if (outcome === 'timeout') bucket.timeout += 1;
      byHarness.set(harness, bucket);
    }
    const ratedTotal = completed + failed + timeout;
    durations.sort((a, b) => a - b);
    const percentile = (sorted: number[], p: number): number | null => {
      if (sorted.length === 0) return null;
      const index = Math.min(
        sorted.length - 1,
        Math.ceil((p / 100) * sorted.length) - 1,
      );
      return sorted[Math.max(0, index)] ?? null;
    };
    return c.json({
      periodDays,
      // The cap the read hit, whatever the fold then skipped.
      capped: rows.length >= EXTERNAL_TURN_METRICS_ROW_CAP,
      total,
      completed,
      failed,
      cancelled,
      timeout,
      recovered,
      successRate: ratedTotal === 0 ? null : completed / ratedTotal,
      timeoutRate: ratedTotal === 0 ? null : timeout / ratedTotal,
      durationP50Ms: percentile(durations, 50),
      durationP95Ms: percentile(durations, 95),
      spentCents,
      byHarness: [...byHarness.entries()]
        .map(([harness, stats]) =>
          Object.assign({ harness }, stats, {
            successRate:
              stats.completed + stats.failed + stats.timeout === 0
                ? null
                : stats.completed /
                  (stats.completed + stats.failed + stats.timeout),
          }),
        )
        .sort((a, b) => b.total - a.total),
    });
  });

  /** Recent per-harness failure ratios (the 0.4 `getHarnessHealth` hint) —
   * pg derives it from settled agent ops, with the same optional session
   * fallback as the metrics read. */
  /** The agent-node op behind one automation run (its execution log) — gated
   * by the run's own project read rule, like every other run read
   * (`../automations/project-visibility.ts`). An organization run is visible to
   * every member; a project run needs read access to its project, so a member
   * outside a team-restricted project learns nothing of what its agent node
   * did. A hidden or missing run answers the same fail-closed `{op:null}` this
   * surface already gives an unknown run and the task door's sandbox-op gives a
   * refused read. */
  app.get('/agent-node-op', async (c) => {
    const organizationId = c.get('orgId');
    const runId = c.req.query('runId') ?? '';
    const run = await getRun(deps.sql, organizationId, runId);
    if (run === null) return c.json({ op: null });
    const auth = await getProjectAuthContext(deps.sql, {
      organizationId,
      userId: c.get('sessionBundle').user.id,
      role: c.get('orgMember').role,
    });
    if (!(await canReadRun(deps.sql, auth, run))) return c.json({ op: null });
    return c.json({
      op: await getAgentNodeSandboxOp(deps.sql, { organizationId, runId }),
    });
  });

  app.get('/harness-health', async (c) => {
    const organizationId = c.get('orgId');
    const since = Date.now() - 30 * 60 * 1000;
    const rows = await deps.sql<
      { harness: string; total: string; failures: string }[]
    >`
      SELECT coalesce(o.harness, s.agent_kind) AS harness,
             count(*)::text AS total,
             count(*) FILTER (WHERE o.status = 'failed')::text AS failures
      FROM app.sandbox_session_ops o
      LEFT JOIN LATERAL (
        SELECT agent_kind FROM app.sandbox_sessions
        WHERE org_id = o.org_id AND session_id = o.session_id
          AND o.harness IS NULL
        ORDER BY created_at_ms DESC, id DESC
        LIMIT 1
      ) s ON true
      WHERE o.org_id = ${organizationId}
        AND o.kind = ANY(${[...SANDBOX_AGENT_OP_KINDS]})
        AND o.started_at_ms >= ${since}
        AND o.status IN ('completed', 'failed')
        -- A start that waited for room settles its op failed, but no
        -- harness turn ran: neither a turn nor a failure of the harness.
        AND (o.agent_result_status IS NULL
          OR o.agent_result_status <> ALL(${[...NO_OUTCOME_RESULT_STATUSES]}))
        AND coalesce(o.harness, s.agent_kind) IS NOT NULL
      GROUP BY coalesce(o.harness, s.agent_kind)
      LIMIT 20
    `;
    return c.json({
      health: rows.map((row) => {
        const total = Number(row.total);
        const failures = Number(row.failures);
        return {
          harness: row.harness,
          recentTotal: total,
          recentFailures: failures,
          degraded: total >= 3 && failures / total >= 0.5,
        };
      }),
    });
  });

  /** The settings page's computed rows (the 0.4 `listSandboxesForOrg`). */
  app.get('/sessions/view', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const organizationId = c.get('orgId');
    const sessions = await listSandboxViewsForOrg(deps.sql, organizationId);
    // Each hibernated agent workspace carries the date the cleanup deletes
    // it on if it stays unused, so nobody is surprised by it.
    const deletions = await unusedWorkspaceDeletions(
      deps.sql,
      organizationId,
      sessions
        .filter(
          (session) =>
            session.ownerType === 'project_agent' &&
            session.status === 'stopped' &&
            !session.pinned,
        )
        .map((session) => session.sessionId),
    );
    // A Destroy runs as a job: each row says whether one is under way, or
    // whether the last one failed.
    const destroys = await sessionDestroyStates(
      deps.sql,
      organizationId,
      sessions.map((session) => session.sessionId),
    );
    for (const session of sessions) {
      session.deletesAt = deletions.get(session.sessionId) ?? null;
      session.destroyState = destroys.get(session.sessionId) ?? null;
    }
    return c.json({ sessions });
  });

  /** Cancel every running op on one session (the 0.4 `stopSandboxTask`). */
  app.post('/sessions/:sessionId/stop-task', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const sessionId = c.req.param('sessionId');
    const owned = await deps.sql<{ id: string }[]>`
      SELECT id FROM app.sandbox_sessions
      WHERE session_id = ${sessionId} AND org_id = ${c.get('orgId')}
      LIMIT 1
    `;
    if (!owned[0]) return c.json({ error: 'SESSION_NOT_FOUND' }, 404);
    const ops = await listRunningOpsBySession(deps.sql, sessionId);
    let cancelled = 0;
    for (const op of ops) {
      try {
        await sessionCancelExec(sessionId, op.execId);
        cancelled += 1;
      } catch (error) {
        console.warn(
          `[sandbox] cancel exec ${op.execId} on ${sessionId} failed:`,
          error,
        );
      }
    }
    return c.json({ cancelled });
  });

  /** Reconcile the org's compute-holding rows with the spawner — the sweep's
   * RECONCILE lane, org-scoped (the mount-time probe that keeps the fleet
   * view honest — the 0.4 `reconcileOrgSessions`). A hibernated (`stopped`)
   * workspace is never a candidate: its container is gone by design, and the
   * spawner's 404 for it is not a phantom to heal. */
  app.post('/reconcile', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return c.json(await reconcileOrgSessions(deps.sql, c.get('orgId')));
  });

  app.post('/sessions/:sessionId/pin', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = pinSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    const pinned = await pinSession(deps.sql, {
      organizationId: c.get('orgId'),
      sessionId: c.req.param('sessionId'),
      pinned: body.data.pinned,
    });
    return pinned
      ? c.json({ pinned: body.data.pinned })
      : c.json({ error: 'session not found' }, 404);
  });

  /** Queue the session's teardown and answer at once: the job waits for the
   * session's lifecycle lock and the spawner's delete, which nobody should
   * watch a dialog spin for (`destroy-schedule.ts`). */
  app.post('/sessions/:sessionId/destroy', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const scheduled = await scheduleSessionDestroy(deps.sql, {
      organizationId: c.get('orgId'),
      sessionId: c.req.param('sessionId'),
    });
    return scheduled
      ? c.json({ scheduled: true }, 202)
      : c.json({ error: 'session not found' }, 404);
  });

  return app;
}
