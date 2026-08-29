import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { sessionCancelExec } from '../../../convex/node_only/sandbox/helpers/session_client.ts';
import {
  DEFAULT_SANDBOX_QUOTA,
  sessionBudgetForOwnerType,
  sessionCapFor,
  type SessionBudget,
} from '../../../convex/sandbox/quota_policy.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { pinSession, reconcileSession, teardownSession } from './service.ts';
import {
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

  /** Recent per-harness failure ratios (the 0.4 `getHarnessHealth` hint) —
   * pg derives it from settled agent ops joined to their session's kind. */
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
