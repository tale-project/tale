import type { Sql, TransactionSql } from 'postgres';

import {
  requireSessionBudgetForOwnerType,
  sessionBudgetForOwnerType,
  sessionCapFor,
  DEFAULT_SANDBOX_QUOTA,
  type SessionBudget,
} from '../../../convex/sandbox/quota_policy.ts';
import {
  SANDBOX_MAX_SESSIONS_PER_OWNER,
  SANDBOX_SESSION_LIVE_STATUSES,
  SANDBOX_SESSION_MAX_LIFETIME_MS,
} from '../../../convex/sandbox/sessions_schema.ts';
import type { SandboxQuotaConfig } from '../../../lib/shared/schemas/governance.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';

/**
 * The sandbox session substrate over PG — the 0.5 twin of
 * `convex/sandbox/session_mutations.ts` + `admission.ts`, with the SAME
 * external semantics (per-owner cap, per-budget org caps from the
 * `sandbox_quota` governance policy, park-on-capacity FIFO tickets with
 * liveness heartbeats, hibernate/resume that frees and re-admits slots,
 * hash-only session tokens, durable op rows) and one rule-5 simplification:
 * the 0.4 OCC ballet (rank probe + recount + WAIT_FIFO race backstop)
 * becomes a per-org advisory lock — every reserve/resume for one org runs
 * its count + rank + claim + insert as one serialized section.
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

/** Park-on-capacity: the caller re-polls; its ticket keeps its FIFO spot. */
export class WaitFifoError extends Error {
  readonly code = 'WAIT_FIFO';

  constructor(message: string) {
    super(message);
    this.name = 'WaitFifoError';
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

/** Serialize every admission decision for one org (count+rank+claim+insert). */
async function lockOrgAdmission(
  tx: TransactionSql,
  organizationId: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended('sandbox:' || ${organizationId}, 0))
  `;
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

export interface AdmissionTicketInput {
  source: 'chat' | 'workflow';
  threadId?: string;
  wfExecutionId?: string;
  stepSlug?: string;
}

/** Upsert the owner's WAITING ticket; returns its stable FIFO `createdAt`.
 * Never re-stamps the FIFO key and never resurrects an admitted ticket. */
async function upsertWaitingTicket(
  tx: TransactionSql,
  args: {
    organizationId: string;
    ownerType: string;
    ownerId: string;
    ticket: AdmissionTicketInput;
  },
  now: number,
): Promise<number> {
  const rows = await tx<{ createdAt: number; status: string }[]>`
    INSERT INTO app.sandbox_admission_tickets (
      org_id, kind, owner_type, owner_id, source, thread_id, wf_execution_id,
      step_slug, status, created_at_ms, last_seen_at_ms
    ) VALUES (
      ${args.organizationId}, 'session', ${args.ownerType}, ${args.ownerId},
      ${args.ticket.source}, ${args.ticket.threadId ?? null},
      ${args.ticket.wfExecutionId ?? null}, ${args.ticket.stepSlug ?? null},
      'waiting', ${now}, ${now}
    )
    ON CONFLICT (owner_type, owner_id) DO UPDATE
      SET last_seen_at_ms = ${now}
    RETURNING created_at_ms::float8 AS "createdAt", status
  `;
  const row = rows[0];
  if (!row) throw new Error('ticket upsert failed');
  return row.createdAt;
}

/** FIFO gate: this waiter may proceed only when it sits within the open
 * slots, ranked by ticket age among same-budget waiters. */
async function assertFifoEligible(
  tx: TransactionSql,
  organizationId: string,
  ticketCreatedAt: number,
  budget: SessionBudget,
): Promise<void> {
  const quota = await readQuota(tx, organizationId);
  const cap = sessionCapFor(budget, quota);
  const inFlight = await inFlightCount(tx, organizationId, budget);
  const slotsOpen = cap - inFlight;
  if (slotsOpen <= 0) {
    throw new WaitFifoError('No sandbox slot open yet; waiting.');
  }
  const waiting = await tx<{ ownerType: string }[]>`
    SELECT owner_type AS "ownerType" FROM app.sandbox_admission_tickets
    WHERE org_id = ${organizationId} AND kind = 'session'
      AND status = 'waiting' AND created_at_ms < ${ticketCreatedAt}
    ORDER BY created_at_ms
  `;
  const rank = waiting.filter(
    (row) => sessionBudgetForOwnerType(row.ownerType) === budget,
  ).length;
  if (rank >= slotsOpen) {
    throw new WaitFifoError('Waiting for an earlier sandbox request to start.');
  }
}

async function claimTicket(
  tx: TransactionSql,
  ownerType: string,
  ownerId: string,
  now: number,
): Promise<void> {
  await tx`
    UPDATE app.sandbox_admission_tickets
    SET status = 'admitted', last_seen_at_ms = ${now}
    WHERE owner_type = ${ownerType} AND owner_id = ${ownerId}
      AND status <> 'admitted'
  `;
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
  /** Present = park-on-capacity mode: the per-org cap is a FIFO queue. */
  ticket?: AdmissionTicketInput;
}

/**
 * Reserve a per-org session slot and insert the `creating` row — one
 * serialized transaction per org, so the slot count and the claim can never
 * race. Throws {@link SandboxQuotaError} on a real conflict (the owner
 * already holds a live session; or the hard cap without a ticket) and
 * {@link WaitFifoError} when parked behind the queue.
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
    if (args.ticket) {
      const createdAt = await upsertWaitingTicket(
        tx,
        {
          organizationId: args.organizationId,
          ownerType: args.ownerType,
          ownerId: args.ownerId,
          ticket: args.ticket,
        },
        now,
      );
      await assertFifoEligible(tx, args.organizationId, createdAt, budget);
      await claimTicket(tx, args.ownerType, args.ownerId, now);
    } else {
      const quota = await readQuota(tx, args.organizationId);
      const cap = sessionCapFor(budget, quota);
      const inFlight = await inFlightCount(tx, args.organizationId, budget);
      if (inFlight >= cap) {
        throw new SandboxQuotaError(
          `At most ${cap} ${budget} sandbox sessions can be active for this organization.`,
        );
      }
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

/** Hibernate: compute released, workspace preserved; frees the org slot. */
export async function markSessionStopped(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_sessions SET status = 'stopped'
    WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
      AND status <> 'stopped' AND pinned = false
    RETURNING id
  `;
  // A freed slot is a release edge; the parked-waiter wake seam lands with
  // the task-agent runs port (the 0.4 waker targets those runs).
  return rows.length > 0;
}

/**
 * Resume in place: normalize the live row to `active`, refresh activity, and
 * reset the TTL window — preserving `createdAt` (same incarnation). A
 * `stopped` row freed its slot, so flipping it back RE-ADMITS through the
 * same FIFO gate as a fresh reserve; already-active rows are an idempotent
 * refresh that never re-counts.
 */
export async function resumeSessionSlot(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    ticket?: AdmissionTicketInput;
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const now = Date.now();
    const rows = await tx<
      {
        id: string;
        status: string;
        ownerType: string;
        ownerId: string;
        pinned: boolean;
      }[]
    >`
      SELECT id, status, owner_type AS "ownerType", owner_id AS "ownerId",
             pinned
      FROM app.sandbox_sessions
      WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
        AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return false;
    if (row.status === 'stopped' && !row.pinned) {
      const budget = requireSessionBudgetForOwnerType(row.ownerType);
      if (args.ticket) {
        const createdAt = await upsertWaitingTicket(
          tx,
          {
            organizationId: args.organizationId,
            ownerType: row.ownerType,
            ownerId: row.ownerId,
            ticket: args.ticket,
          },
          now,
        );
        await assertFifoEligible(tx, args.organizationId, createdAt, budget);
        await claimTicket(tx, row.ownerType, row.ownerId, now);
      } else {
        const quota = await readQuota(tx, args.organizationId);
        const cap = sessionCapFor(budget, quota);
        const inFlight = await inFlightCount(tx, args.organizationId, budget);
        if (inFlight >= cap) {
          throw new SandboxQuotaError(
            `At most ${cap} ${budget} sandbox sessions can be active for this organization.`,
          );
        }
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

/** Terminal: mark destroyed + revoke tokens + drop the checkpoint + ticket. */
export async function markSessionDestroyed(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const now = Date.now();
    const rows = await tx<{ ownerType: string; ownerId: string }[]>`
      UPDATE app.sandbox_sessions SET
        status = 'destroyed', destroyed_at_ms = ${now}
      WHERE session_id = ${args.sessionId} AND org_id = ${args.organizationId}
        AND status <> 'destroyed'
      RETURNING owner_type AS "ownerType", owner_id AS "ownerId"
    `;
    const row = rows[0];
    if (!row) return false;
    await tx`
      UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${now}
      WHERE session_id = ${args.sessionId} AND revoked_at_ms IS NULL
    `;
    await tx`
      DELETE FROM app.sandbox_agent_checkpoints
      WHERE session_id = ${args.sessionId}
    `;
    await tx`
      DELETE FROM app.sandbox_admission_tickets
      WHERE owner_type = ${row.ownerType} AND owner_id = ${row.ownerId}
    `;
    return true;
  });
}

/** Owner lifecycle cascade (thread delete, workflow-run end, erasure). */
export async function listLiveSessionsForOwner(
  sql: Sql,
  ownerType: string,
  ownerId: string,
): Promise<SessionRow[]> {
  return sql<SessionRow[]>`
    SELECT ${sql.unsafe(SESSION_COLUMNS)} FROM app.sandbox_sessions
    WHERE owner_type = ${ownerType} AND owner_id = ${ownerId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
  `;
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

export async function revokeTokensForSession(
  sql: Sql,
  organizationId: string,
  sessionId: string,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${Date.now()}
    WHERE session_id = ${sessionId} AND org_id = ${organizationId}
      AND revoked_at_ms IS NULL
    RETURNING id
  `;
  return rows.length;
}

// --- op rows ----------------------------------------------------------------

export async function startSessionOp(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    kind: 'exec' | 'agent-run';
    threadId?: string;
    userId?: string;
    agentSlug?: string;
    modelRef?: string;
    deadlineMs?: number;
  },
): Promise<string> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.sandbox_session_ops (
      org_id, session_id, thread_id, exec_id, kind, status, user_id,
      agent_slug, model_ref, deadline_ms, heartbeat_at_ms, started_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.sessionId}, ${args.threadId ?? null},
      ${args.execId}, ${args.kind}, 'running', ${args.userId ?? null},
      ${args.agentSlug ?? null}, ${args.modelRef ?? null},
      ${args.deadlineMs ?? null}, ${now}, ${now}
    )
    ON CONFLICT (session_id, exec_id) DO UPDATE SET heartbeat_at_ms = ${now}
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('op insert failed');
  return id;
}

/** Throttled live-progress flush (the caller owns the throttle). */
export async function flushOpProgress(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    progressText?: string;
    liveTimeline?: unknown;
    lastSeq?: number;
    agentSessionId?: string;
  },
): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.sandbox_session_ops SET
      progress_text = coalesce(${args.progressText ?? null}, progress_text),
      live_timeline = coalesce(${args.liveTimeline === undefined ? null : sql.json(toJson(args.liveTimeline))}, live_timeline),
      last_seq = coalesce(${args.lastSeq ?? null}, last_seq),
      agent_session_id = coalesce(${args.agentSessionId ?? null}, agent_session_id),
      heartbeat_at_ms = ${now}, last_event_at_ms = ${now}
    WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
      AND status = 'running'
  `;
}

/** Settle an op exactly once; a second finalize is a no-op. */
export async function finalizeSessionOp(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    status: 'completed' | 'failed' | 'cancelled';
    exitCode?: number;
    agentResultStatus?: string;
  },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_session_ops SET
      status = ${args.status},
      exit_code = ${args.exitCode ?? null},
      agent_result_status = ${args.agentResultStatus ?? null},
      finished_at_ms = ${now}, finalized_at_ms = ${now}
    WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
      AND finalized_at_ms IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

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

/** Latest agent-run op for a thread — the live-progress read. */
export async function latestAgentRunForThread(
  sql: Sql,
  threadId: string,
): Promise<SessionOpRow | null> {
  const rows = await sql<SessionOpRow[]>`
    SELECT ${sql.unsafe(OP_COLUMNS)} FROM app.sandbox_session_ops
    WHERE thread_id = ${threadId} AND kind = 'agent-run'
    ORDER BY started_at_ms DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Watchdog scan: running ops whose heartbeat went stale. */
export async function listAbandonedOps(
  sql: Sql,
  staleBeforeMs: number,
): Promise<SessionOpRow[]> {
  return sql<SessionOpRow[]>`
    SELECT ${sql.unsafe(OP_COLUMNS)} FROM app.sandbox_session_ops
    WHERE status = 'running' AND heartbeat_at_ms < ${staleBeforeMs}
  `;
}

// --- admission polling / reaping --------------------------------------------

/**
 * Cheap front gate for a parking caller: upsert/refresh the WAITING ticket
 * and answer whether the reserve is worth attempting (the reserve itself
 * re-checks atomically under the org lock).
 */
export async function pollAdmission(
  sql: Sql,
  args: {
    organizationId: string;
    ownerType: string;
    ownerId: string;
    ticket: AdmissionTicketInput;
  },
): Promise<{ proceed: boolean }> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const now = Date.now();
    const createdAt = await upsertWaitingTicket(
      tx,
      {
        organizationId: args.organizationId,
        ownerType: args.ownerType,
        ownerId: args.ownerId,
        ticket: args.ticket,
      },
      now,
    );
    try {
      await assertFifoEligible(
        tx,
        args.organizationId,
        createdAt,
        requireSessionBudgetForOwnerType(args.ownerType),
      );
      return { proceed: true };
    } catch (error) {
      if (error instanceof WaitFifoError) {
        return { proceed: false };
      }
      throw error;
    }
  });
}

/** 429-after-claim: put an admitted ticket back to WAITING (keeps its FIFO
 * key, so the retry does not lose its place). */
export async function parkAdmissionTicket(
  sql: Sql,
  ownerType: string,
  ownerId: string,
): Promise<void> {
  await sql`
    UPDATE app.sandbox_admission_tickets
    SET status = 'waiting', last_seen_at_ms = ${Date.now()}
    WHERE owner_type = ${ownerType} AND owner_id = ${ownerId}
  `;
}

export async function deleteAdmissionTicket(
  sql: Sql,
  ownerType: string,
  ownerId: string,
): Promise<void> {
  await sql`
    DELETE FROM app.sandbox_admission_tickets
    WHERE owner_type = ${ownerType} AND owner_id = ${ownerId}
  `;
}

/** Reap tickets whose poll-chain died — the only guard against permanent
 * queue-head starvation under indefinite wait. Returns reaped count. */
export async function reapStaleAdmissionTickets(
  sql: Sql,
  staleBeforeMs: number,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM app.sandbox_admission_tickets
    WHERE last_seen_at_ms < ${staleBeforeMs}
    RETURNING id
  `;
  return rows.length;
}

// --- workflow re-attach checkpoints ------------------------------------------

export interface AgentCheckpoint {
  sessionId: string;
  execId: string;
  lastSeq: number;
  agentSessionId?: string;
  agentResultSeen?: boolean;
  agentIdle?: boolean;
  pendingTaskIds?: string[];
  apiErrorSeen?: boolean;
  taskRunId?: string;
  startedAt: number;
  continuationCount: number;
}

export async function saveAgentCheckpoint(
  sql: Sql,
  organizationId: string,
  checkpoint: AgentCheckpoint,
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO app.sandbox_agent_checkpoints (
      session_id, org_id, exec_id, last_seq, agent_session_id,
      agent_result_seen, agent_idle, pending_task_ids, api_error_seen,
      task_run_id, started_at_ms, continuation_count, updated_at_ms
    ) VALUES (
      ${checkpoint.sessionId}, ${organizationId}, ${checkpoint.execId},
      ${checkpoint.lastSeq}, ${checkpoint.agentSessionId ?? null},
      ${checkpoint.agentResultSeen ?? null}, ${checkpoint.agentIdle ?? null},
      ${checkpoint.pendingTaskIds ?? null},
      ${checkpoint.apiErrorSeen ?? null}, ${checkpoint.taskRunId ?? null},
      ${checkpoint.startedAt}, ${checkpoint.continuationCount}, ${now}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      exec_id = EXCLUDED.exec_id, last_seq = EXCLUDED.last_seq,
      agent_session_id = EXCLUDED.agent_session_id,
      agent_result_seen = EXCLUDED.agent_result_seen,
      agent_idle = EXCLUDED.agent_idle,
      pending_task_ids = EXCLUDED.pending_task_ids,
      api_error_seen = EXCLUDED.api_error_seen,
      task_run_id = EXCLUDED.task_run_id,
      continuation_count = EXCLUDED.continuation_count,
      updated_at_ms = ${now}
  `;
}

export async function loadAgentCheckpoint(
  sql: Sql,
  organizationId: string,
  sessionId: string,
): Promise<AgentCheckpoint | null> {
  const rows = await sql<
    (Omit<AgentCheckpoint, 'pendingTaskIds'> & {
      pendingTaskIds: string[] | null;
    })[]
  >`
    SELECT session_id AS "sessionId", exec_id AS "execId",
           last_seq::float8 AS "lastSeq",
           agent_session_id AS "agentSessionId",
           agent_result_seen AS "agentResultSeen", agent_idle AS "agentIdle",
           pending_task_ids AS "pendingTaskIds",
           api_error_seen AS "apiErrorSeen", task_run_id AS "taskRunId",
           started_at_ms::float8 AS "startedAt",
           continuation_count AS "continuationCount"
    FROM app.sandbox_agent_checkpoints
    WHERE session_id = ${sessionId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null),
  ) as unknown as AgentCheckpoint;
}

export async function deleteAgentCheckpoint(
  sql: Sql,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  await sql`
    DELETE FROM app.sandbox_agent_checkpoints
    WHERE session_id = ${sessionId} AND org_id = ${organizationId}
  `;
}
