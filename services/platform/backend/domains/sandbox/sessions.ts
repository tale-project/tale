import type { SandboxQuotaConfig } from '@tale/shared/schemas/governance';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import type { Sql, TransactionSql } from 'postgres';

import {
  isAgentRunWaitingReason,
  type AgentRunWaitingReason,
} from '../../../lib/shared/agent-run-waiting.ts';
import { readCheckpoints } from '../../core/automations/checkpoints.ts';
import type { TurnConnectorCaller } from '../../core/node_only/sandbox/connectors_bridge.ts';
import {
  requireSessionBudgetForOwnerType,
  sessionBudgetForOwnerType,
  sessionCapFor,
  DEFAULT_SANDBOX_QUOTA,
  type SessionBudget,
} from '../../core/sandbox/quota_policy.ts';
import {
  SANDBOX_DESTROY_PENDING_MESSAGE,
  SANDBOX_DESTROY_PENDING_REASON,
  SANDBOX_MAX_SESSIONS_PER_OWNER,
  SANDBOX_SESSION_LIVE_STATUSES,
  SANDBOX_SESSION_MAX_LIFETIME_MS,
  WORKFLOW_AGENT_OP_KIND,
} from '../../core/sandbox/session_constants.ts';
import {
  projectAgentWorker,
  sessionIdForWorkflowExecution,
} from '../../core/sandbox/session_naming.ts';
import type { TurnOpRef } from '../../core/sandbox/tool_names.ts';
import { SANDBOX_SESSION_HELD_REASON } from '../../core/tasks/run_park_reason.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  wakeAgentParkedAgentRun,
  wakeParkedAgentRuns,
} from '../tasks/agent-runs.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import {
  sessionDestroyPending,
  type SandboxDestroyState,
} from './destroy-schedule.ts';
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
 * `markSessionDestroyed`) and by the task-agent watchdog.
 *
 * The pure policy pieces (`sessionBudgetForOwnerType`, `sessionCapFor`,
 * the status vocabulary, the caps) are REUSED from the 0.4 modules so the
 * two stacks cannot drift while both exist.
 */

export class SandboxQuotaError extends Error {
  readonly code = 'QUOTA_EXCEEDED';
  /** Set when the refusal is no want of the organization's room: the
   * session's Destroy is pending ({@link SandboxDestroyPendingError}), or
   * the workspace already holds a live session of its own
   * ({@link SANDBOX_SESSION_HELD_REASON}). The shims carry it on. */
  readonly reason:
    | typeof SANDBOX_DESTROY_PENDING_REASON
    | typeof SANDBOX_SESSION_HELD_REASON
    | undefined;

  constructor(
    message: string,
    reason?:
      | typeof SANDBOX_DESTROY_PENDING_REASON
      | typeof SANDBOX_SESSION_HELD_REASON,
  ) {
    super(message);
    this.name = 'SandboxQuotaError';
    this.reason = reason;
  }
}

/**
 * The session's workspace is being deleted: an administrator's Destroy of
 * its live row is queued, retrying or running (`destroy-schedule.ts`). A
 * turn let in now would work in files the next attempt deletes, and lose
 * its tokens and gateway keys with them, so the admission verbs refuse it
 * before it starts. A quota refusal on purpose, marked
 * {@link SANDBOX_DESTROY_PENDING_REASON} so no lane reads it as a full
 * budget: a task's run parks on it and is woken when the Destroy settles
 * (`markSessionDestroyed` is a release edge) or by the watchdog's next
 * tick, then starts in a fresh workspace, or in this one once every attempt
 * has failed; an automation step fails with this reason instead, at once
 * and without a retry, since a later start of it would continue its run in
 * a fresh, empty workspace without what its earlier steps left
 * (`classifyWorkflowStartFailure`).
 */
class SandboxDestroyPendingError extends SandboxQuotaError {
  constructor() {
    super(SANDBOX_DESTROY_PENDING_MESSAGE, SANDBOX_DESTROY_PENDING_REASON);
    this.name = 'SandboxDestroyPendingError';
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
  tx: Sql | TransactionSql,
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

/**
 * The organization's agent-worker budget as a reserve or a resume counts
 * it: the cap (`maxSessionsPerOrg`) and the workers that hold a slot of it
 * now. For a caller that decides before any reserve whether a run may open
 * or wake a worker — the worker claim (`domains/tasks/agent-workers.ts`),
 * which holds the organization's admission lock as an exact count needs, or
 * a start telling its requester whether its run will wait.
 */
export async function projectSessionRoom(
  tx: Sql | TransactionSql,
  organizationId: string,
): Promise<{ cap: number; inFlight: number }> {
  const quota = await readQuota(tx, organizationId);
  return {
    cap: sessionCapFor('project', quota),
    inFlight: await inFlightCount(tx, organizationId, 'project'),
  };
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
 * host parks its run on that code — and {@link SandboxDestroyPendingError}
 * while a live row under the id is being destroyed: a fresh incarnation
 * beside it would be the newest row, which the Destroy's retry leaves alone
 * and whose files the spawner still holds.
 */
export async function reserveSessionSlot(
  sql: Sql,
  args: ReserveSessionArgs,
): Promise<string> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    if (await sessionDestroyPending(tx, args)) {
      throw new SandboxDestroyPendingError();
    }
    const now = Date.now();

    // One live session per workspace. A project agent owns several — a
    // worker of its standing family and of each member's family for every
    // run of it working at the same time — each with its own session id, so
    // its cap counts per session. Meeting it is no want of the
    // organization's room: a second start raced into the same worker.
    const perSession = args.ownerType === 'project_agent';
    const ownerActive = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.sandbox_sessions
      WHERE owner_type = ${args.ownerType} AND owner_id = ${args.ownerId}
        AND (${!perSession} OR session_id = ${args.sessionId})
        AND status IN ('creating', 'active')
    `;
    if (
      Number(ownerActive[0]?.count ?? '0') >= SANDBOX_MAX_SESSIONS_PER_OWNER
    ) {
      throw new SandboxQuotaError(
        `This ${args.ownerType} already has an active sandbox session.`,
        perSession ? SANDBOX_SESSION_HELD_REASON : undefined,
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
  sql: Sql | TransactionSql,
  organizationId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  // Latest incarnation: a healed phantom re-provisions the same
  // deterministic id, so several rows can share it — newest wins.
  const rows = await sql<SessionRow[]>`
    SELECT ${sql.unsafe(SESSION_COLUMNS)} FROM app.sandbox_sessions
    WHERE session_id = ${sessionId} AND org_id = ${organizationId}
    ORDER BY created_at_ms DESC, id DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function listSessionsForOrg(
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

/** creating → active for ONE incarnation whose compute the drift reconcile
 * recreated (its host died before runnerd-ready). By row id and only from
 * `creating`, so a status a host or a Destroy set meanwhile stands. */
export async function markRecreatedSessionActive(
  sql: Sql,
  args: { organizationId: string; rowId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_sessions SET
      status = 'active', last_activity_at_ms = ${Date.now()}
    WHERE id = ${args.rowId} AND org_id = ${args.organizationId}
      AND status = 'creating'
    RETURNING id
  `;
  return rows.length > 0;
}

/** "Always-on" pin: exempt from the idle reaper + the hard TTL. An unpin also
 * counts as the workspace's last use: a pinned period is no disuse, so the
 * workspace cleanup's window starts over (`workspace-cleanup.ts`) instead of
 * taking a long-pinned workspace within the hour. */
export async function setSessionPinned(
  sql: Sql | TransactionSql,
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
        ELSE ${now + SANDBOX_SESSION_MAX_LIFETIME_MS}::bigint END,
      last_activity_at_ms = CASE WHEN ${args.pinned} THEN last_activity_at_ms
        ELSE greatest(coalesce(last_activity_at_ms, 0), ${now}::bigint) END
    WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Release a project agent's idle workers at the end of a turn — the ONE
 * seam behind the host's settle release, its rollback after a failed
 * resume-create, a park, the deadline watchdog's slot free and the task
 * watchdog's orphan backstop. Each of the agent's live, unpinned workers
 * hibernates (`stopped`: compute released, workspace preserved, slot freed)
 * unless an op is still running on it, or a live run (queued or running,
 * not parked for capacity) names it — the run working there, one that has
 * claimed it and not started yet, or a fresh kick that still names its
 * family's first worker. The guard is the worker's: a worker gives its slot
 * back as soon as its own run ends, whatever the agent's other workers are
 * doing. A freed slot is a release edge: the organization's next parked run,
 * and the next parked run of the other organizations (the sandbox host is
 * shared), are woken at once instead of idling until the 2-minute watchdog
 * tick (`wakeParkedAgentRuns`). A release that names the workspace of the
 * turn that ended and did not stop it — pinned, or still held — also wakes
 * the agent's oldest parked run: that worker is free for it without a slot
 * of its own, and the ended exec gave back one of its runtime's live-exec
 * places (`wakeAgentParkedAgentRun`). Best-effort — a wake failure must
 * never fail the release.
 */
export async function releaseProjectAgentSessionSlot(
  sql: Sql,
  args: { organizationId: string; agentId: string; sessionId?: string },
  readTicket?: IdleReleaseTicketReader,
  /** `wake: false` frees the slot without waking a parked run: the release
   * of a run that is itself parking for room, which would otherwise wake
   * the next parked run straight into the same refusal. */
  opts: { wake?: boolean } = {},
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
        WHERE r.org_id = s.org_id AND r.session_id = s.session_id
          AND r.status IN ('queued', 'running')
          AND r.waiting_for_capacity_at_ms IS NULL
      )
    RETURNING s.org_id AS "organizationId", s.session_id AS "sessionId"
  `;
    await enqueueIdleSessionReleases(tx, released, tickets);
    return released;
  });
  if (rows.length > 0 && opts.wake !== false) {
    await wakeParkedAgentRuns(sql, args.organizationId).catch(
      (error: unknown) => {
        console.warn('[sandbox] capacity wake failed:', error);
      },
    );
  }
  if (
    args.sessionId !== undefined &&
    opts.wake !== false &&
    !rows.some((row) => row.sessionId === args.sessionId)
  ) {
    await wakeAgentParkedAgentRun(sql, {
      organizationId: args.organizationId,
      agentId: args.agentId,
      sessionId: args.sessionId,
    }).catch((error: unknown) => {
      console.warn('[sandbox] workspace wake failed:', error);
    });
  }
  return rows.length > 0;
}

/**
 * Resume in place: normalize the live row to `active`, refresh activity, and
 * reset the TTL window — preserving `createdAt` (same incarnation). A
 * `stopped` row freed its slot, so flipping it back RE-ADMITS through the
 * same cap check as a fresh reserve; already-active rows are an idempotent
 * refresh that never re-counts. A row an administrator's Destroy is
 * removing is refused before anything changes
 * ({@link SandboxDestroyPendingError}): the row id is all the Destroy's
 * retry checks, and a resume keeps it. False when no live row is left to
 * resume — none was, or one was settled while this ran.
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
    if (await sessionDestroyPending(tx, { ...args, rowId: row.id })) {
      throw new SandboxDestroyPendingError();
    }
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
    // Against a terminal write, the write itself is the boundary. The row
    // read above holds no lock and a settlement takes no admission lock
    // (`markSessionDestroyed` — a Destroy attempt's under the session's
    // lifecycle lock, a heal's or a reclaim's under none — the cleanup's
    // claim, a watchdog's stamp), so one can commit anywhere in this
    // transaction, also before the predicate, which then finds no live row
    // and so no pending Destroy. The write therefore moves the row only
    // while it is still live: moving nothing answers that the allocation is
    // gone, as if the settlement had come first, so no caller resumes a
    // settled incarnation, and its next start opens a fresh one. A write
    // that lands holds the row until this commit, so nothing settles it in
    // between. After it, an administrator's Destroy settles only from
    // inside an attempt, while its job is unfinished: one queued before
    // this transaction took the admission lock either refused the turn at
    // the predicate or had settled the row already, leaving the write
    // nothing to move; one asked for later waits for that lock, so it is
    // ordered after this turn, which it cancels.
    const moved = await tx<{ id: string }[]>`
      UPDATE app.sandbox_sessions SET
        status = 'active', last_activity_at_ms = ${now},
        expires_at_ms = CASE WHEN pinned THEN expires_at_ms
          ELSE ${now + SANDBOX_SESSION_MAX_LIFETIME_MS} END
      WHERE id = ${row.id}
        AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
      RETURNING id
    `;
    return moved.length > 0;
  });
}

/**
 * Hibernate ONE incarnation whose compute is gone while the spawner keeps its
 * workspace — the reconcile's heal of an agent session after a host reboot,
 * a daemon restart or the OOM killer took its container. The row reads
 * `stopped` (its slot freed, its `createdAt` kept), so the next turn resumes
 * it in place on the preserved files and conversation, exactly as after an
 * idle release. By row id, only from a compute-holding status and only while
 * unpinned, under the organization's admission lock like every release (a
 * resume taken first keeps the row). The credentials go as at every
 * teardown edge — the gateway keys settled and deleted, the session tokens
 * revoked: the compute that held them is gone, and the next turn mints its
 * own. A freed slot is a release edge, so parked runs are woken.
 */
export async function markSessionStopped(
  sql: Sql,
  args: { organizationId: string; sessionId: string; rowId: string },
): Promise<boolean> {
  const stopped = await sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const rows = await tx<{ id: string }[]>`
      UPDATE app.sandbox_sessions SET status = 'stopped'
      WHERE id = ${args.rowId} AND org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND status IN ('creating', 'active', 'degraded')
        AND pinned = false
      RETURNING id
    `;
    return rows.length > 0;
  });
  if (!stopped) return false;
  await revokeSessionGatewayKeys(sql, args).catch((error: unknown) => {
    console.error(
      `[sandbox] gateway key reclaim for stopped ${args.sessionId} failed:`,
      error,
    );
  });
  await wakeParkedAgentRuns(sql, args.organizationId).catch(
    (error: unknown) => {
      console.warn('[sandbox] capacity wake failed:', error);
    },
  );
  return true;
}

/** Terminal: revoke the gateway keys + mark destroyed + revoke tokens. The
 * single bottom of EVERY destroy — the admin Destroy, the watchdog's
 * phantom heal and ended-run reclaim, the session teardown — so credential
 * reclaim cannot be missed on one of them. The one exception is a failed
 * create's row, which never minted credentials: the watchdog's collect pass
 * stamps it by primary key, because its session id may already name a live
 * successor this function would settle too. */
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
  /** A user-keyed session: its connector calls act for this user, and its
   * workspace tools may READ as them. */
  userId?: string;
  /** The task run a turn's connector calls act through: the exec whose
   * live run's starter they act for. It names no person, so the scope holds
   * no identity (the connectors bridge reads it; the workspace tools never
   * do). */
  connectorCaller?: TurnConnectorCaller;
  /** The task run a task turn serves — every task turn's token names its
   * exec. The workspace tools read the live run on it: a run its starter
   * could not have edited the project for acts on its own task alone. */
  taskRun?: { execId: string };
  /** The op this token's turn is — written only on a turn granted
   * `generate_image`, whose dispatch books the images under that op's run
   * and saves them into its delivery box. Names no person either. */
  turnOp?: TurnOpRef;
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
  /** The task a project agent's op works, as a reader knows it: its key
   * (`KEY-12`, when its project has one) and title. Absent for a task gone
   * since. */
  task?: { id: string; projectId: string; key?: string; title: string };
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
  /** Which of its agent's workers a project agent's session is: the
   * agent's own (`agent`) or one a member's runs work in (`member`), and its
   * number within that family. Absent for any other session. */
  worker?: { number: number; scope: 'agent' | 'member' };
  pinned: boolean;
  createdAt: number;
  lastActivityAt: number | null;
  status: string;
  busy: boolean;
  /** The op the page leads with: a running one, else the latest. */
  currentOp: SandboxCurrentOpView | null;
  /** Every op still running, oldest first. A worker runs one task's turn
   * at a time, but a steered turn's predecessor in its kill grace, or a turn
   * an older image started during a rolling deploy, can run beside it, so
   * the settings page lists all of them rather than one "current" turn. */
  runningOps: SandboxCurrentOpView[];
  totalSpentCents: number;
  /** When the workspace is deleted for being unused, if it stays unused
   * (`unusedWorkspaceDeletions`); null when nothing will delete it. */
  deletesAt?: number | null;
  /** An administrator's Destroy under way (`pending`) or one whose every
   * attempt failed (`failed`); null when none is (`sessionDestroyStates`). */
  destroyState?: SandboxDestroyState | null;
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
           right(o.progress_text, 280) AS "progressText",
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
  // A standing workspace keeps its lifetime history. Index it once so each
  // poll visits that history once, rather than once per visible workspace.
  const opsBySession = Map.groupBy(ops, (op) => op.sessionId);

  const views = sessions.map((session): SandboxSessionView => {
    let current: SessionOpViewRow | null = null;
    let currentRunning = false;
    let busy = false;
    let totalSpentCents = 0;
    const running: SessionOpViewRow[] = [];
    for (const op of opsBySession.get(session.sessionId) ?? []) {
      totalSpentCents += op.spentCents ?? 0;
      // finalizedAt is the authoritative done-signal — a recovered turn
      // whose status never flipped must not read as "busy".
      const isRunning = op.status === 'running' && op.finalizedAt === null;
      if (isRunning) busy = true;
      if (isRunning) running.push(op);
      const wins =
        current === null ||
        (isRunning && !currentRunning) ||
        (isRunning === currentRunning && op.startedAt > current.startedAt);
      if (!wins) continue;
      currentRunning = isRunning;
      current = op;
    }
    // Project only displayed rows, regardless of the database's history
    // order. Oldest-first history must not build and discard every view.
    const toView = (op: SessionOpViewRow): SandboxCurrentOpView => ({
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
      // SQL bounds the transferred tail by Unicode characters; slice
      // keeps the existing 280 UTF-16 code-unit display boundary.
      ...(op.progressText !== null
        ? { progressText: op.progressText.slice(-280) }
        : {}),
      ...(op.heartbeatAt !== null ? { heartbeatAt: op.heartbeatAt } : {}),
    });
    const currentOp = current === null ? null : toView(current);
    // The same object rides both lists, so the task lookup below stamps
    // its taskId once for both.
    const runningOps = running.map((op) =>
      op === current && currentOp !== null ? currentOp : toView(op),
    );
    runningOps.sort((a, b) => a.startedAt - b.startedAt);
    const owner = userById.get(session.createdBy);
    const view: SandboxSessionView = {
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
      currentOp,
      runningOps,
      totalSpentCents,
    };
    const worker =
      session.ownerType === 'project_agent'
        ? projectAgentWorker(session.ownerId, session.sessionId)
        : null;
    if (worker !== null) {
      view.worker = { number: worker.worker, scope: worker.scope };
    }
    return view;
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
    // The task's key and title ride the same read: an Owner or Admin reads
    // every project of the organization, so naming the task leaks nothing.
    const runs = await sql<
      {
        sessionId: string;
        execId: string;
        taskId: string;
        projectId: string | null;
        title: string | null;
        number: number | null;
        projectKey: string | null;
      }[]
    >`
      SELECT DISTINCT ON (r.session_id, r.exec_id)
        r.session_id AS "sessionId", r.exec_id AS "execId",
        r.task_id AS "taskId", t.project_id AS "projectId", t.title,
        t.number, p.key AS "projectKey"
      FROM app.project_agent_runs r
      LEFT JOIN app.tasks t ON t.id = r.task_id AND t.org_id = r.org_id
      LEFT JOIN app.projects p ON p.id = t.project_id AND p.org_id = r.org_id
      WHERE r.org_id = ${organizationId}
        AND r.session_id = ANY(${taskOps.map((entry) => entry.sessionId)})
        AND r.exec_id = ANY(${taskOps.map((entry) => entry.op.execId)})
      ORDER BY r.session_id, r.exec_id, r.seq DESC
    `;
    const tasks = new Map(
      runs.map((run) => [`${run.sessionId}:${run.execId}`, run]),
    );
    for (const { sessionId, op } of taskOps) {
      const run = tasks.get(`${sessionId}:${op.execId}`);
      if (run === undefined) continue;
      op.taskId = run.taskId;
      if (run.projectId !== null && run.title !== null) {
        const key = formatTaskIdentifier(run.projectKey, run.number);
        op.task = {
          id: run.taskId,
          projectId: run.projectId,
          ...(key !== null ? { key } : {}),
          title: run.title,
        };
      }
    }
  }
  views.sort((a, b) => {
    if (a.busy !== b.busy) return a.busy ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return views;
}

/** How many of the organization's agent runs wait for room, all of them
 * counted (no page cap), by why they wait: the demand behind a full limit
 * of agent workers. `unknown` counts a run parked without a kept reason. */
export interface WaitingAgentRunCounts {
  total: number;
  byReason: Record<AgentRunWaitingReason | 'unknown', number>;
}

export async function countWaitingAgentRuns(
  sql: Sql,
  organizationId: string,
): Promise<WaitingAgentRunCounts> {
  const rows = await sql<{ reason: string | null; count: number }[]>`
    SELECT waiting_reason AS reason, count(*)::int AS count
    FROM app.project_agent_runs
    WHERE org_id = ${organizationId} AND status = 'queued'
      AND waiting_for_capacity_at_ms IS NOT NULL
    GROUP BY waiting_reason
  `;
  const byReason: Record<AgentRunWaitingReason | 'unknown', number> = {
    org_limit: 0,
    host: 0,
    destroy_pending: 0,
    exec_limit: 0,
    unknown: 0,
  };
  let total = 0;
  for (const row of rows) {
    const reason = isAgentRunWaitingReason(row.reason) ? row.reason : 'unknown';
    byReason[reason] += row.count;
    total += row.count;
  }
  return { total, byReason };
}

/**
 * The agent-node op behind one automation run — what the run dialog's
 * execution log renders (its live timeline, the model that actually served
 * the turn, and where it got to). The session id is DERIVED from the run
 * (`sessionIdForWorkflowExecution`), so the lookup needs no join table.
 *
 * A node selector binds the read to its durable trace or live cursor's exec.
 * Unknown identities (including older traces) fail closed, never borrowing
 * another step's log. Omitting the selector preserves the run-wide latest op.
 * Returns null for a foreign run or a step without an operation.
 */
export async function getAgentNodeSandboxOp(
  sql: Sql,
  args: { organizationId: string; runId: string; nodeId?: string },
): Promise<Record<string, unknown> | null> {
  const runs = await sql<
    { id: string; checkpoints: unknown; trace: unknown }[]
  >`
    SELECT id, checkpoints, trace FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined) return null;
  let execId: string | undefined;
  if (args.nodeId !== undefined) {
    const checkpoints = readCheckpoints(run.checkpoints);
    const cursor = checkpoints.cursor;
    execId =
      cursor?.node === args.nodeId
        ? cursor.agent?.execId
        : checkpoints.nodes[args.nodeId]?.trace?.execId;
    if (execId === undefined && Array.isArray(run.trace)) {
      const entry = run.trace.find(
        (value: unknown) =>
          value !== null &&
          typeof value === 'object' &&
          'node' in value &&
          value.node === args.nodeId &&
          'type' in value &&
          value.type === 'agent',
      );
      if (
        entry !== null &&
        typeof entry === 'object' &&
        'execId' in entry &&
        typeof entry.execId === 'string'
      ) {
        execId = entry.execId;
      }
    }
    if (typeof execId !== 'string' || execId === '') return null;
  }
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
      AND (${execId ?? null}::text IS NULL OR exec_id = ${execId ?? null})
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
