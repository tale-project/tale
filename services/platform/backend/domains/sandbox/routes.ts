import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  DEFAULT_SANDBOX_QUOTA,
  sessionBudgetForOwnerType,
  sessionCapFor,
  type SessionBudget,
} from '../../core/sandbox/quota_policy.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { pinSession, reconcileSession, teardownSession } from './service.ts';
import {
  getAgentNodeSandboxOp,
  listRunningOpsBySession,
  listSandboxViewsForOrg,
  listSessionsForOrg,
} from './sessions.ts';
import {
  deleteMyEnvVar,
  listMyEnv,
  upsertMyEnvVar,
  UserEnvError,
} from './user-env.ts';

/**
 * /api/app/sandbox — the sandbox-management surface: the org's live
 * sessions (with their running ops), always-on pinning, and explicit
 * teardown. Administering sandbox compute is org configuration, so every
 * route is gated on the `orgSettings` write capability.
 */

const pinSchema = z.object({ pinned: z.boolean() });

function requireAdmin(c: Context<OrgEnv>): Response | null {
  const allowed = defineAbilityFor(c.get('orgMember').role).can(
    'write',
    'orgSettings',
  );
  return allowed ? null : c.json({ error: 'admin capability required' }, 403);
}

export function createSandboxRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const envScope = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
  });

  // User-level env/secrets (always self-scoped; secrets write-only).
  app.get('/user-env', async (c) => {
    return c.json({ env: await listMyEnv(deps.sql, envScope(c)) });
  });

  app.post('/user-env', async (c) => {
    const body = z
      .object({
        key: z.string().min(1).max(128),
        value: z.string().max(8192),
        isSecret: z.boolean(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      await transactSerializable(deps.sql, (tx) =>
        upsertMyEnvVar(tx, envScope(c), body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof UserEnvError) {
        return c.json({ error: error.code, message: error.message }, 400);
      }
      throw error;
    }
  });

  app.delete('/user-env/:key', async (c) => {
    return c.json(
      await deleteMyEnvVar(deps.sql, envScope(c), c.req.param('key')),
    );
  });

  /** Per-budget quota pressure (the 0.4 `getSandboxQuotaUsage` wire). */
  app.get('/quota-usage', async (c) => {
    const denied = requireAdmin(c);
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
   * a continued turn). Developer-gated like the 0.4 read. */
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
             s.agent_kind AS harness,
             (o.finished_at_ms - o.started_at_ms)::float8 AS "durationMs",
             o.spent_cents AS "spentCents",
             coalesce(o.continuation_count, 0) > 0 AS recovered
      FROM app.sandbox_session_ops o
      JOIN app.sandbox_sessions s ON s.session_id = o.session_id
      WHERE o.org_id = ${c.get('orgId')}
        AND o.kind = 'agent-run'
        AND o.finished_at_ms IS NOT NULL
        AND o.started_at_ms >= ${since}
      ORDER BY o.started_at_ms DESC
      LIMIT 5000
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
      total += 1;
      durations.push(row.durationMs);
      if (row.spentCents !== null) spentCents += row.spentCents;
      if (row.recovered) recovered += 1;
      const outcome = row.outcome ?? row.status;
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
      capped: total >= 5000,
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
   * pg derives it from settled agent ops joined to their session's kind. */
  /** The agent-node op behind one automation run (its execution log). */
  app.get('/agent-node-op', async (c) => {
    return c.json({
      op: await getAgentNodeSandboxOp(deps.sql, {
        organizationId: c.get('orgId'),
        runId: c.req.query('runId') ?? '',
      }),
    });
  });

  app.get('/harness-health', async (c) => {
    const organizationId = c.get('orgId');
    const since = Date.now() - 30 * 60 * 1000;
    const rows = await deps.sql<
      { harness: string; total: string; failures: string }[]
    >`
      SELECT s.agent_kind AS harness, count(*)::text AS total,
             count(*) FILTER (WHERE o.status = 'failed')::text AS failures
      FROM app.sandbox_session_ops o
      JOIN app.sandbox_sessions s ON s.session_id = o.session_id
      WHERE o.org_id = ${organizationId}
        AND o.kind = 'agent-run'
        AND o.started_at_ms >= ${since}
        AND o.status IN ('completed', 'failed')
        AND s.agent_kind IS NOT NULL
      GROUP BY s.agent_kind
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
    return c.json({
      sessions: await listSandboxViewsForOrg(deps.sql, c.get('orgId')),
    });
  });

  app.get('/sessions', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const sessions = await listSessionsForOrg(deps.sql, c.get('orgId'));
    const withOps = await Promise.all(
      sessions.map(async (session) =>
        Object.assign(
          {
            runningOps: await listRunningOpsBySession(
              deps.sql,
              session.sessionId,
            ),
          },
          session,
        ),
      ),
    );
    return c.json({ sessions: withOps });
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

  /** Reconcile the org's live rows with the spawner (the mount-time probe
   * that keeps the fleet view honest — the 0.4 `reconcileOrgSessions`). */
  app.post('/reconcile', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const organizationId = c.get('orgId');
    const sessions = await listSessionsForOrg(deps.sql, organizationId);
    let healed = 0;
    for (const session of sessions.slice(0, 25)) {
      try {
        const outcome = await reconcileSession(deps.sql, {
          organizationId,
          sessionId: session.sessionId,
        });
        if (outcome === 'healed') healed += 1;
      } catch (error) {
        console.warn(
          `[sandbox] reconcile ${session.sessionId} failed (left as live):`,
          error,
        );
      }
    }
    return c.json({ healed });
  });

  app.post('/sessions/:sessionId/pin', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = pinSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
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

  app.post('/sessions/:sessionId/destroy', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const destroyed = await teardownSession(deps.sql, {
      organizationId: c.get('orgId'),
      sessionId: c.req.param('sessionId'),
    });
    return destroyed
      ? c.json({ destroyed: true })
      : c.json({ error: 'session not found' }, 404);
  });

  return app;
}
