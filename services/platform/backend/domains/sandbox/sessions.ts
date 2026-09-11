import type { SandboxQuotaConfig } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  requireSessionBudgetForOwnerType,
  sessionBudgetForOwnerType,
  sessionCapFor,
  DEFAULT_SANDBOX_QUOTA,
  type SessionBudget,
} from '../../core/sandbox/quota_policy.ts';
import {
  SANDBOX_MAX_SESSIONS_PER_OWNER,
  SANDBOX_SESSION_LIVE_STATUSES,
  SANDBOX_SESSION_MAX_LIFETIME_MS,
  WORKFLOW_AGENT_OP_KIND,
} from '../../core/sandbox/session_constants.ts';
import { sessionIdForWorkflowExecution } from '../../core/sandbox/session_naming.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import {
  captureIdleReleaseTickets,
  enqueueIdleSessionReleases,
  type IdleReleaseSession,
  type IdleReleaseTicketReader,
} from './idle-release.ts';

/**
 * The sandbox session substrate over PG — the 0.5 twin of
 * `convex/sandbox/session_mutations.ts`, with the SAME external semantics
 * (per-owner cap, per-budget org caps from the `sandbox_quota` governance
 * policy, hibernate/resume that frees and re-admits slots, hash-only session
 * tokens) and one rule-5 simplification: the 0.4 OCC ballet (rank probe +
 * recount) becomes a per-org advisory lock — every reserve/resume for one
 * org runs its count + claim + insert as one serialized section.
 *
 * Capacity parking is NOT a concern of this module: a project-agent run
 * that meets a full org parks on its own ledger row
 * (`project_agent_runs.waiting_for_capacity_at_ms`, tasks/agent-runs.ts)
 * and is woken on the release edges here (`releaseProjectAgentSessionSlot`,
 * `markSessionDestroyed`) and by the task-agent watchdog. The 0.4 FIFO
 * admission-ticket lane (`app.sandbox_admission_tickets`) and the
 * workflow re-attach checkpoints (`app.sandbox_agent_checkpoints`) were
 * never wired into a 0.5 caller; nothing reads or writes either table any
 * more, and both are dropped in a later release once no serving image
 * touches them (rolling-deploy doctrine — see the create-migration skill).
 *
 * The pure policy pieces (`sessionBudgetForOwnerType`, `sessionCapFor`,
 * the status vocabulary, the caps) are REUSED from the 0.4 modules so the
 * two stacks cannot drift while both exist.
 */

export class SandboxQuotaError extends Error {
  readonly code = 'QUOTA_EXCEEDED';

  constructor(message: string) {
    super(message);
    this.name = 'SandboxQuotaError';
  }
}

export interface SessionRow {
  id: string;
  organizationId: string;
  sessionId: string;
  profile: unknown;
  status: string;
  ownerType: string;
  ownerId: string;
  createdBy: string;
  agentKind: string | null;
  llmGatewayKeyId: string | null;
  pinned: boolean;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number | null;
  destroyedAt: number | null;
}

const SESSION_COLUMNS = `
  id, org_id AS "organizationId", session_id AS "sessionId", profile, status,
  owner_type AS "ownerType", owner_id AS "ownerId", created_by AS "createdBy",
  agent_kind AS "agentKind", llm_gateway_key_id AS "llmGatewayKeyId", pinned,
  created_at_ms::float8 AS "createdAt", expires_at_ms::float8 AS "expiresAt",
  last_activity_at_ms::float8 AS "lastActivityAt",
  destroyed_at_ms::float8 AS "destroyedAt"
`;

async function readQuota(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<SandboxQuotaConfig> {
  const policy = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'sandbox_quota',
  );
  return policy ?? DEFAULT_SANDBOX_QUOTA;
}

async function inFlightCount(
  tx: TransactionSql,
  organizationId: string,
  budget: SessionBudget,
): Promise<number> {
  const rows = await tx<{ ownerType: string }[]>`
    SELECT owner_type AS "ownerType" FROM app.sandbox_sessions
    WHERE org_id = ${organizationId} AND status IN ('creating', 'active')
  `;
  return rows.filter(
    (row) => sessionBudgetForOwnerType(row.ownerType) === budget,
  ).length;
}

export interface ReserveSessionArgs {
  organizationId: string;
  sessionId: string;
  profile: unknown;
  ownerType: string;
  ownerId: string;
  createdBy: string;
  agentKind?: string;
  ttlMs?: number;
}

/**
 * Reserve a per-org session slot and insert the `creating` row — one
 * serialized transaction per org, so the slot count and the claim can never
 * race. Throws {@link SandboxQuotaError} on a conflict (the owner already
 * holds a live session, or the budget's cap is reached) — the task-agent
 * host parks its run on that code.
 */
export async function reserveSessionSlot(
  sql: Sql,
  args: ReserveSessionArgs,
): Promise<string> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const now = Date.now();

    const ownerActive = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.sandbox_sessions
      WHERE owner_type = ${args.ownerType} AND owner_id = ${args.ownerId}
        AND status IN ('creating', 'active')
    `;
    if (
      Number(ownerActive[0]?.count ?? '0') >= SANDBOX_MAX_SESSIONS_PER_OWNER
    ) {
      throw new SandboxQuotaError(
        `This ${args.ownerType} already has an active sandbox session.`,
      );
    }

    const budget = requireSessionBudgetForOwnerType(args.ownerType);
    const quota = await readQuota(tx, args.organizationId);
    const cap = sessionCapFor(budget, quota);
    const inFlight = await inFlightCount(tx, args.organizationId, budget);
    if (inFlight >= cap) {
      throw new SandboxQuotaError(
        `At most ${cap} ${budget} sandbox sessions can be active for this organization.`,
      );
    }

    const ttlMs = args.ttlMs ?? SANDBOX_SESSION_MAX_LIFETIME_MS;
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, profile, status, owner_type, owner_id, created_by,
        agent_kind, created_at_ms, expires_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.sessionId},
        ${
          // The profile may be a BARE string ('agent'): encode explicitly —
          // the pool serializer passes strings through as already-JSON.
          args.profile === undefined
            ? null
            : tx.json(toJson(JSON.stringify(args.profile)))
        },
        'creating', ${args.ownerType}, ${args.ownerId}, ${args.createdBy},
        ${args.agentKind ?? null}, ${now}, ${now + ttlMs}
      )
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('session insert failed');
    return id;
  });
}

export async function getSessionBySessionId(
  sql: Sql,
  organizationId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  // Latest incarnation: a healed phantom re-provisions the same
  // deterministic id, so several rows can share it — newest wins.
  const rows = await sql<SessionRow[]>`
    SELECT ${sql.unsafe(SESSION_COLUMNS)} FROM app.sandbox_sessions
    WHERE session_id = ${sessionId} AND org_id = ${organizationId}
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listSessionsForOrg(
  sql: Sql,
  organizationId: string,
): Promise<SessionRow[]> {
  return sql<SessionRow[]>`
    SELECT ${sql.unsafe(SESSION_COLUMNS)} FROM app.sandbox_sessions
    WHERE org_id = ${organizationId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
    ORDER BY created_at_ms DESC
  `;
}

/** Flip a live session's lifecycle status (creating → active on
 * runnerd-ready; → degraded/destroyed/expired/failed otherwise). */
export async function setSessionStatus(
  sql: Sql,
  args: { organizationId: string; sessionId: string; status: string },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_sessions SET
      status = ${args.status},
      last_activity_at_ms = ${now},
      destroyed_at_ms = CASE WHEN ${args.status} = 'destroyed'
        THEN ${now}::bigint ELSE destroyed_at_ms END
    WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
    RETURNING id
  `;
  return rows.length > 0;
}

/** "Always-on" pin: exempt from the idle reaper + the hard TTL. */
export async function setSessionPinned(
  sql: Sql,
  args: { organizationId: string; sessionId: string; pinned: boolean },
): Promise<boolean> {
  const now = Date.now();
  const farFuture = now + 10 * 365 * 24 * 60 * 60 * 1000;
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_sessions SET
      pinned = ${args.pinned},
      pinned_at_ms = CASE WHEN ${args.pinned}
        THEN ${now}::bigint ELSE NULL END,
      expires_at_ms = CASE WHEN ${args.pinned} THEN ${farFuture}::bigint
        ELSE ${now + SANDBOX_SESSION_MAX_LIFETIME_MS}::bigint END
    WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Release a project agent's standing-session slot at the end of a turn —
 * the ONE seam behind the host's settle release, its rollback after a
 * failed resume-create, the deadline watchdog's slot free and the task
 * watchdog's orphan backstop. The session hibernates (`stopped`: compute
 * released, workspace preserved, slot freed) unless a sibling turn's op is
 * still running on it, a live turn of the agent (queued or running, not
 * parked for capacity) still owns the slot before its exec exists, or the
 * row is pinned. A freed slot is a release edge: the org's oldest parked
 * run is woken at once instead of idling until the 2-minute watchdog tick.
 * Best-effort — a wake failure must never fail the release.
 */
export async function releaseProjectAgentSessionSlot(
  sql: Sql,
  args: { organizationId: string; agentId: string },
  readTicket?: IdleReleaseTicketReader,
): Promise<boolean> {
  // The runtime release tickets are read BEFORE the transaction: the
  // spawner round-trip must not run under the org's admission lock (every
  // reserve/resume of the org would wait on it) or pin a pool connection. A
  // ticket captured early is safe by the daemon's generation check — a turn
  // that re-acquires the session in between rotates the generation and the
  // release job is refused; a candidate that appears after this read gets no
  // ticket and simply keeps its warm compute until the ordinary reaper.
  const candidates = await sql<IdleReleaseSession[]>`
    SELECT org_id AS "organizationId", session_id AS "sessionId"
    FROM app.sandbox_sessions
    WHERE owner_type = 'project_agent' AND owner_id = ${args.agentId}
      AND org_id = ${args.organizationId}
      AND status IN ('creating', 'active', 'degraded') AND pinned = false
  `;
  const tickets = await captureIdleReleaseTickets(candidates, readTicket);
  const rows = await sql.begin(async (tx) => {
    // Order release with re-admission before touching the owner's rows. A
    // delayed old settle cannot uncount a newer turn's pre-exec allocation.
    await lockOrgAdmission(tx, args.organizationId);
    const released = await tx<IdleReleaseSession[]>`
    UPDATE app.sandbox_sessions s SET status = 'stopped'
    WHERE s.owner_type = 'project_agent' AND s.owner_id = ${args.agentId}
      AND s.org_id = ${args.organizationId}
      AND s.status IN ('creating', 'active', 'degraded')
      AND s.pinned = false
      AND NOT EXISTS (
        SELECT 1 FROM app.sandbox_session_ops op
        WHERE op.session_id = s.session_id AND op.status = 'running'
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.project_agent_runs r
        WHERE r.org_id = s.org_id AND r.agent_id = s.owner_id
          AND r.status IN ('queued', 'running')
          AND r.waiting_for_capacity_at_ms IS NULL
      )
    RETURNING s.org_id AS "organizationId", s.session_id AS "sessionId"
  `;
    await enqueueIdleSessionReleases(tx, released, tickets);
    return released;
  });
  if (rows.length > 0) {
    await wakeParkedAgentRuns(sql, args.organizationId).catch(
      (error: unknown) => {
        console.warn('[sandbox] capacity wake failed:', error);
      },
    );
  }
  return rows.length > 0;
}

/**
 * Resume in place: normalize the live row to `active`, refresh activity, and
 * reset the TTL window — preserving `createdAt` (same incarnation). A
 * `stopped` row freed its slot, so flipping it back RE-ADMITS through the
 * same cap check as a fresh reserve; already-active rows are an idempotent
 * refresh that never re-counts.
 */
export async function resumeSessionSlot(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const now = Date.now();
    const rows = await tx<
      { id: string; status: string; ownerType: string; pinned: boolean }[]
    >`
      SELECT id, status, owner_type AS "ownerType", pinned
      FROM app.sandbox_sessions
      WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
        AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return false;
    if (row.status === 'stopped' && !row.pinned) {
      const budget = requireSessionBudgetForOwnerType(row.ownerType);
      const quota = await readQuota(tx, args.organizationId);
      const cap = sessionCapFor(budget, quota);
      const inFlight = await inFlightCount(tx, args.organizationId, budget);
      if (inFlight >= cap) {
        throw new SandboxQuotaError(
          `At most ${cap} ${budget} sandbox sessions can be active for this organization.`,
        );
      }
    }
    await tx`
      UPDATE app.sandbox_sessions SET
        status = 'active', last_activity_at_ms = ${now},
        expires_at_ms = CASE WHEN pinned THEN expires_at_ms
          ELSE ${now + SANDBOX_SESSION_MAX_LIFETIME_MS} END
      WHERE id = ${row.id}
    `;
    return true;
  });
}

/** Terminal: revoke the gateway keys + mark destroyed + revoke tokens. The
 * single bottom of EVERY destroy — the admin Destroy, the watchdog's
 * phantom heal and ended-run reclaim, the session teardown — so credential
 * reclaim cannot be missed on one of them. */
export async function markSessionDestroyed(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<boolean> {
  // Credentials FIRST: the gateway key outlives the row (no native TTL), and
  // the token flip below is what elects a single revoker — running it after
  // the flip would find nothing to revoke. Best-effort by construction, so a
  // down gateway cannot wedge the destroy; see `gateway-keys.ts`.
  await revokeSessionGatewayKeys(sql, args).catch((error: unknown) => {
    console.error(
      `[sandbox] gateway key reclaim for destroyed ${args.sessionId} failed:`,
      error,
    );
  });
  return sql
    .begin(async (tx) => {
      const now = Date.now();
      const rows = await tx<{ id: string }[]>`
      UPDATE app.sandbox_sessions SET
        status = 'destroyed', destroyed_at_ms = ${now}
      WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
        AND status <> 'destroyed'
      RETURNING id
    `;
      if (rows.length === 0) return false;
      await tx`
      UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${now}
      WHERE session_id = ${args.sessionId} AND revoked_at_ms IS NULL
    `;
      return true;
    })
    .then(async (destroyed) => {
      if (destroyed) {
        // Release edge (see releaseProjectAgentSessionSlot) — after the commit.
        await wakeParkedAgentRuns(sql, args.organizationId).catch(
          (error: unknown) => {
            console.warn('[sandbox] capacity wake failed:', error);
          },
        );
      }
      return destroyed;
    });
}

// --- session tokens ---------------------------------------------------------

export interface SessionTokenScope {
  agentKind: string;
  allowedModels: string[];
  connectorGrants: string[];
  budgetCents: number;
  toolGrants?: string[];
  agentSlug?: string;
  threadId?: string;
  userId?: string;
}

/** Persist a minted token's sha256 hash + scope (never the plaintext). */
export async function insertSessionToken(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    tokenHash: string;
    llmGatewayKeyId?: string;
    scope: SessionTokenScope;
    ttlMs: number;
  },
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO app.sandbox_session_tokens (
      org_id, session_id, token_hash, llm_gateway_key_id, scope,
      created_at_ms, expires_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.sessionId}, ${args.tokenHash},
      ${args.llmGatewayKeyId ?? null}, ${sql.json(toJson(args.scope))},
      ${now}, ${now + args.ttlMs}
    )
  `;
}

export interface SessionTokenRow {
  organizationId: string;
  sessionId: string;
  scope: SessionTokenScope;
  llmGatewayKeyId: string | null;
  expiresAt: number;
  revokedAt: number | null;
}

/** The dispatch-auth lookup: live (unrevoked, unexpired) token by hash. */
export async function getSessionTokenByHash(
  sql: Sql,
  tokenHash: string,
): Promise<SessionTokenRow | null> {
  const rows = await sql<SessionTokenRow[]>`
    SELECT org_id AS "organizationId", session_id AS "sessionId", scope,
           llm_gateway_key_id AS "llmGatewayKeyId",
           expires_at_ms::float8 AS "expiresAt",
           revoked_at_ms::float8 AS "revokedAt"
    FROM app.sandbox_session_tokens
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.revokedAt !== null || row.expiresAt <= Date.now()) {
    return null;
  }
  return row;
}

// --- op rows ----------------------------------------------------------------

export interface SessionOpRow {
  id: string;
  organizationId: string;
  sessionId: string;
  threadId: string | null;
  execId: string;
  kind: string;
  status: string;
  progressText: string | null;
  agentSessionId: string | null;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  heartbeatAt: number | null;
}

const OP_COLUMNS = `
  id, org_id AS "organizationId", session_id AS "sessionId",
  thread_id AS "threadId", exec_id AS "execId", kind, status,
  progress_text AS "progressText", agent_session_id AS "agentSessionId",
  exit_code AS "exitCode", started_at_ms::float8 AS "startedAt",
  finished_at_ms::float8 AS "finishedAt",
  heartbeat_at_ms::float8 AS "heartbeatAt"
`;

export async function listRunningOpsBySession(
  sql: Sql,
  sessionId: string,
): Promise<SessionOpRow[]> {
  return sql<SessionOpRow[]>`
    SELECT ${sql.unsafe(OP_COLUMNS)} FROM app.sandbox_session_ops
    WHERE session_id = ${sessionId} AND status = 'running'
  `;
}

export interface SandboxCurrentOpView {
  kind?: 'task-agent' | 'workflow-agent';
  taskId?: string;
  workflowRunId?: string;
  threadId?: string;
  execId: string;
  status: string;
  continuationCount?: number;
  spentCents?: number;
  pausedReason?: string;
  progressText?: string;
  startedAt: number;
  heartbeatAt?: number;
}

export interface SandboxSessionView {
  sessionId: string;
  ownerType: string;
  ownerId: string;
  createdBy: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  ownerLabel?: string | null;
  agentKind: string | null;
  pinned: boolean;
  createdAt: number;
  lastActivityAt: number | null;
  status: string;
  busy: boolean;
  /** The op the page leads with: a running one, else the latest. */
  currentOp: SandboxCurrentOpView | null;
  /** Every op still running, oldest first. A project agent runs its tasks
   * concurrently in the ONE workspace it owns, so the settings page lists
   * all of them rather than one "current" turn. */
  runningOps: SandboxCurrentOpView[];
  totalSpentCents: number;
}

interface SessionOpViewRow {
  sessionId: string;
  threadId: string | null;
  execId: string;
  status: string;
  continuationCount: number | null;
  spentCents: number | null;
  pausedReason: string | null;
  progressText: string | null;
  startedAt: number;
  heartbeatAt: number | null;
  finalizedAt: number | null;
}

/**
 * The Sandboxes settings page's rows (the 0.4 `listSandboxesForOrg` view):
 * live sessions with owner names, busy state, the current op, and the
 * incarnation's lifetime spend — busy first, then newest.
 */
export async function listSandboxViewsForOrg(
  sql: Sql,
  organizationId: string,
): Promise<SandboxSessionView[]> {
  const sessions = await listSessionsForOrg(sql, organizationId);
  if (sessions.length === 0) return [];
  const sessionIds = sessions.map((session) => session.sessionId);
  const ops = await sql<SessionOpViewRow[]>`
    SELECT o.session_id AS "sessionId", o.thread_id AS "threadId",
           o.exec_id AS "execId", o.status,
           o.continuation_count AS "continuationCount",
           o.spent_cents AS "spentCents", o.paused_reason AS "pausedReason",
           o.progress_text AS "progressText",
           o.started_at_ms::float8 AS "startedAt",
           o.heartbeat_at_ms::float8 AS "heartbeatAt",
           o.finalized_at_ms::float8 AS "finalizedAt"
    FROM app.sandbox_session_ops o
    WHERE o.org_id = ${organizationId} AND o.session_id = ANY(${sessionIds})
  `;
  const owners = await sql<{ sessionId: string; label: string | null }[]>`
    SELECT s.session_id AS "sessionId", coalesce(a.name, r.name) AS label
    FROM app.sandbox_sessions s
    LEFT JOIN app.project_agents a ON s.owner_type = 'project_agent'
      AND a.org_id = s.org_id AND a.id = s.owner_id
    LEFT JOIN app.automation_runs r ON s.owner_type = 'workflow_run'
      AND r.org_id = s.org_id AND r.id = split_part(s.owner_id, ':', 1)
    WHERE s.org_id = ${organizationId} AND s.id = ANY(${sessions.map((session) => session.id)})
  `;
  const ownerLabels = new Map(
    owners.map((owner) => [owner.sessionId, owner.label]),
  );
  const userIds = [...new Set(sessions.map((session) => session.createdBy))];
  const users = await sql<
    { id: string; name: string | null; email: string | null }[]
  >`
    SELECT "id", "name", "email" FROM "user" WHERE "id" = ANY(${userIds})
  `;
  const userById = new Map(users.map((user) => [user.id, user] as const));

  const views = sessions.map((session): SandboxSessionView => {
    let current: SandboxCurrentOpView | null = null;
    let currentRunning = false;
    let busy = false;
    let totalSpentCents = 0;
    const running: SandboxCurrentOpView[] = [];
    for (const op of ops) {
      if (op.sessionId !== session.sessionId) continue;
      totalSpentCents += op.spentCents ?? 0;
      // finalizedAt is the authoritative done-signal — a recovered turn
      // whose status never flipped must not read as "busy".
      const isRunning = op.status === 'running' && op.finalizedAt === null;
      if (isRunning) busy = true;
      const view: SandboxCurrentOpView = {
        execId: op.execId,
        status: op.status,
        startedAt: op.startedAt,
        ...(session.ownerType === 'project_agent'
          ? { kind: 'task-agent' as const }
          : {}),
        ...(session.ownerType === 'workflow_run'
          ? {
              kind: 'workflow-agent' as const,
              workflowRunId: session.ownerId.split(':')[0],
            }
          : {}),
        ...(op.threadId !== null ? { threadId: op.threadId } : {}),
        ...(op.continuationCount !== null
          ? { continuationCount: op.continuationCount }
          : {}),
        ...(op.spentCents !== null ? { spentCents: op.spentCents } : {}),
        ...(op.pausedReason !== null ? { pausedReason: op.pausedReason } : {}),
        ...(op.progressText !== null
          ? { progressText: op.progressText.slice(-280) }
          : {}),
        ...(op.heartbeatAt !== null ? { heartbeatAt: op.heartbeatAt } : {}),
      };
      // The same object rides both lists, so the task lookup below stamps
      // its taskId once for both.
      if (isRunning) running.push(view);
      const wins =
        current === null ||
        (isRunning && !currentRunning) ||
        (isRunning === currentRunning && op.startedAt > current.startedAt);
      if (!wins) continue;
      currentRunning = isRunning;
      current = view;
    }
    running.sort((a, b) => a.startedAt - b.startedAt);
    const owner = userById.get(session.createdBy);
    return {
      sessionId: session.sessionId,
      ownerType: session.ownerType,
      ownerId: session.ownerId,
      createdBy: session.createdBy,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
      ownerLabel: ownerLabels.get(session.sessionId) ?? null,
      agentKind: session.agentKind,
      pinned: session.pinned,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      status: session.status,
      busy,
      currentOp: current,
      runningOps: running,
      totalSpentCents,
    };
  });
  // Resolve task ownership only for the displayed operations (the lead op
  // plus every running one), in one org-scoped read. Joining every
  // historical op to the run ledger would repeat the lookup for a standing
  // workspace's entire lifetime.
  const taskOpsByKey = new Map<
    string,
    { sessionId: string; op: SandboxCurrentOpView }
  >();
  for (const view of views) {
    if (view.ownerType !== 'project_agent') continue;
    for (const op of [
      ...(view.currentOp !== null ? [view.currentOp] : []),
      ...view.runningOps,
    ]) {
      taskOpsByKey.set(`${view.sessionId}:${op.execId}`, {
        sessionId: view.sessionId,
        op,
      });
    }
  }
  const taskOps = [...taskOpsByKey.values()];
  if (taskOps.length > 0) {
    const runs = await sql<
      { sessionId: string; execId: string; taskId: string }[]
    >`
      SELECT DISTINCT ON (session_id, exec_id)
        session_id AS "sessionId", exec_id AS "execId", task_id AS "taskId"
      FROM app.project_agent_runs
      WHERE org_id = ${organizationId}
        AND session_id = ANY(${taskOps.map((entry) => entry.sessionId)})
        AND exec_id = ANY(${taskOps.map((entry) => entry.op.execId)})
      ORDER BY session_id, exec_id, seq DESC
    `;
    const tasks = new Map(
      runs.map((run) => [`${run.sessionId}:${run.execId}`, run.taskId]),
    );
    for (const { sessionId, op } of taskOps) {
      const taskId = tasks.get(`${sessionId}:${op.execId}`);
      if (taskId !== undefined) op.taskId = taskId;
    }
  }
  views.sort((a, b) => {
    if (a.busy !== b.busy) return a.busy ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return views;
}

/**
 * The agent-node op behind one automation run — what the run dialog's
 * execution log renders (its live timeline, the model that actually served
 * the turn, and where it got to). The session id is DERIVED from the run
 * (`sessionIdForWorkflowExecution`), so the lookup needs no join table.
 *
 * Returns null for a run that is not this org's, or one that has never
 * reached its agent node — the log then renders nothing rather than an
 * error.
 */
export async function getAgentNodeSandboxOp(
  sql: Sql,
  args: { organizationId: string; runId: string },
): Promise<Record<string, unknown> | null> {
  const runs = await sql<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  if (runs[0] === undefined) return null;
  const sessionId = sessionIdForWorkflowExecution(args.runId);
  const rows = await sql<
    {
      execId: string;
      status: string;
      progressText: string | null;
      liveTimeline: unknown;
      modelRef: string | null;
      visionModelRef: string | null;
      startedAt: number;
      finishedAt: number | null;
      lastEventAt: number | null;
    }[]
  >`
    SELECT exec_id AS "execId", status, progress_text AS "progressText",
           live_timeline AS "liveTimeline", model_ref AS "modelRef",
           vision_model_ref AS "visionModelRef",
           started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt",
           last_event_at_ms::float8 AS "lastEventAt"
    FROM app.sandbox_session_ops
    WHERE session_id = ${sessionId} AND org_id = ${args.organizationId}
      AND kind = ${WORKFLOW_AGENT_OP_KIND}
    ORDER BY started_at_ms DESC, id DESC
    LIMIT 1
  `;
  const op = rows[0];
  if (op === undefined) return null;
  return {
    execId: op.execId,
    status: op.status,
    ...(op.progressText !== null ? { progressText: op.progressText } : {}),
    ...(op.liveTimeline !== null ? { liveTimeline: op.liveTimeline } : {}),
    ...(op.modelRef !== null ? { modelRef: op.modelRef } : {}),
    ...(op.visionModelRef !== null
      ? { visionModelRef: op.visionModelRef }
      : {}),
    startedAt: op.startedAt,
    ...(op.finishedAt !== null ? { finishedAt: op.finishedAt } : {}),
    ...(op.lastEventAt !== null ? { lastEventAt: op.lastEventAt } : {}),
  };
}
