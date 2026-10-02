import { createHash } from 'node:crypto';

import {
  DEFAULT_SANDBOX_WORKSPACES,
  type SandboxWorkspacesConfig,
} from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import {
  SandboxDeviceOfflineError,
  sandboxDeviceDisconnect,
  sandboxOrganizationTeardown,
  sandboxWorkspaceInventory,
  sessionDestroy,
  sessionDestroyIfIdle,
  sessionDestroyStopped,
  sessionSetPinned,
  type SandboxWorkspaceInventory,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { revokeVirtualKey } from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import {
  isProjectAgentSession,
  isStandingProjectAgentSession,
  memberSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { loadActiveHolds, type ActiveHolds } from '../legal_holds/service.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import { withSessionLifecycleLock } from './service.ts';
import {
  readUnusedRuleSince,
  recordUnusedWorkspaceRule,
} from './unused-rule.ts';

/**
 * Sandbox workspace cleanup — deleting the `/agent` workspaces nothing owns
 * any more, and the ones nobody has used for the organization's window.
 *
 * A workspace outlives its compute: the idle reaper only stops a session and
 * keeps its workspace for the next turn. That is the point for a project
 * agent that comes back to its work, and a leak for everything else — a
 * deleted agent, a member who left, an automation run that ended while its
 * session was healed away, a crawler render cut off mid-batch, a deleted
 * organization. Three triggers reach it, all through {@link retireWorkspace}:
 *
 *  - the owner's deletion, as it happens: a job enqueued in the deleting
 *    transaction (`sandbox.retire_workspaces`, `sandbox.retire_organization`)
 *    and, for an erasure, a pass of the cascade itself;
 *  - the hourly sweep (`sandbox.workspace_gc`, {@link runWorkspaceCleanup}):
 *    every project-agent workspace the rows name, judged by
 *    {@link workspaceVerdict} — owner gone, or unused past the
 *    `sandbox_workspaces` policy's window — then every workspace the
 *    spawner's inventory lists that no row owns any more;
 *  - the Sandboxes page's explicit Destroy, which keeps its own path
 *    (`teardownSession`, run by the `sandbox.destroy_session` job).
 *
 * Nothing here deletes on a guess. A decision is taken again under the
 * organization's admission lock right before the rows change (a turn that
 * resumed the workspace in between keeps it); the spawner refuses a
 * workspace that still has compute running, or an exec, depending on the
 * mode; a legal hold keeps everything it covers; and a spawner, gateway or
 * device that cannot answer leaves the workspace for the next attempt.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A workspace the inventory lists but that changed this recently is left
 * alone whatever the rows say: a create may still be committing its row, and
 * a clock between hosts may be off. */
const WORKSPACE_CLEANUP_GRACE_MS = DAY_MS;

/** How long after its run ended an automation run's workspace belongs to the
 * sandbox watchdog's reclaim, which deletes it with the run's own rows. */
const ENDED_RUN_GRACE_MS = 60 * 60 * 1000;

/** Workspaces one sweep deletes at most: a backlog (the first sweep after an
 * upgrade, a large deleted project) drains over the next hours rather than
 * holding the job past its window. */
const SWEEP_RETIRE_LIMIT = 50;

/** Deletions each pass of a sweep attempts at most, per allowed deletion:
 * what a busy, offline or failing workspace costs is bounded, and no number
 * of them keeps the rest waiting for ever — each sweep also walks in a
 * different order. */
const SWEEP_ATTEMPTS_PER_RETIRE = 4;

const HOUR_MS = 60 * 60 * 1000;

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'success',
  'failed',
  'cancelled',
]);

/** Row statuses a resume can pick up again. */
const LIVE_STATUSES: ReadonlySet<string> = new Set([
  'creating',
  'active',
  'degraded',
  'stopped',
]);

/** Why a workspace was deleted — recorded on its audit row. */
export type WorkspaceRetireReason =
  /** Its project agent (or the agent's project) was deleted. */
  | 'agent_deleted'
  /** It held a member's runs with an agent, and the member left. */
  | 'member_removed'
  /** It held a member's runs with an agent, and the member was erased. */
  | 'member_erased'
  /** Nobody used it for the organization's `unusedDays`. */
  | 'unused'
  /** Nothing owns it any more: its run ended, its render was cut off, or no
   * row names it at all. */
  | 'orphaned';

/**
 * How firmly the spawner is asked:
 *  - `stopped` — only the preserved workspace of a session with no compute
 *    at all (what nobody uses);
 *  - `idle` — unless an exec runs in it (the owner is gone; a warm or
 *    always-on container goes with the workspace);
 *  - `force` — whatever runs (an erasure).
 */
export type WorkspaceDestroyMode = 'stopped' | 'idle' | 'force';

export type WorkspaceRetireOutcome =
  /** The spawner deleted it; the rows settled. */
  | 'destroyed'
  /** The spawner held nothing under the id; the rows settled. */
  | 'absent'
  /** Decided again, and still wanted (a turn came back to it meanwhile). */
  | 'kept'
  /** Work runs in it — the next attempt tries again. */
  | 'busy'
  /** Its device is not connected — the next attempt tries again. */
  | 'offline'
  /** The spawner could not be asked — the next attempt tries again. */
  | 'failed';

/** Outcomes that leave the workspace for a later attempt. */
function pending(outcome: WorkspaceRetireOutcome): boolean {
  return outcome === 'busy' || outcome === 'offline' || outcome === 'failed';
}

/** The spawner verbs the cleanup uses — injectable so the unit layer and the
 * real-Postgres probe drive it with a scripted spawner. */
export interface WorkspaceSpawner {
  destroy: (
    sessionId: string,
    mode: WorkspaceDestroyMode,
  ) => Promise<{ destroyed: boolean; busy: boolean }>;
  /** `null` from a spawner without an inventory. */
  inventory: () => Promise<SandboxWorkspaceInventory | null>;
  /** `null` from a spawner without the route. */
  teardownOrganization: (organizationId: string) => Promise<unknown>;
  disconnectDevice: (deviceId: string) => Promise<unknown>;
  revokeKey: (keyId: string) => Promise<void>;
  /** Drop the spawner's own pin, so a container a refused destroy leaves
   * behind is reaped like any other. */
  unpin: (sessionId: string) => Promise<unknown>;
}

const DEFAULT_SPAWNER: WorkspaceSpawner = {
  destroy: async (sessionId, mode) => {
    if (mode === 'stopped') return sessionDestroyStopped(sessionId);
    if (mode === 'idle') return sessionDestroyIfIdle(sessionId);
    return { destroyed: await sessionDestroy(sessionId), busy: false };
  },
  inventory: sandboxWorkspaceInventory,
  teardownOrganization: sandboxOrganizationTeardown,
  disconnectDevice: sandboxDeviceDisconnect,
  revokeKey: revokeVirtualKey,
  unpin: (sessionId) => sessionSetPinned(sessionId, false),
};

// --- the one retire path ----------------------------------------------------

export interface RetireWorkspaceArgs {
  /** The organization whose rows name the session; `null` for a workspace no
   * row of any organization names. */
  organizationId: string | null;
  sessionId: string;
  reason: WorkspaceRetireReason;
  mode: WorkspaceDestroyMode;
  /** Decided again under the organization's admission lock, right before
   * the rows change: `false` keeps the workspace. */
  eligible?: (tx: TransactionSql) => Promise<boolean>;
  /** What the decision read (a last use), for the audit row. */
  detail?: Record<string, unknown>;
}

/**
 * Delete one workspace, under the session's lifecycle lock (so it never
 * interleaves with a Destroy, a pin or a pinned recreate):
 *
 *  1. CLAIM — under the organization's admission lock, which every resume
 *     takes too: re-decide (`eligible`), then end the session's live
 *     incarnation (`expired`, unpinned). A turn that resumed it first keeps
 *     it; a turn after the claim finds no live row and starts a FRESH
 *     incarnation, so no harness ever resumes a conversation whose files are
 *     gone. `stopped` mode claims only a hibernated session (compute of any
 *     kind is "in use"); `idle` mode waits while an exec runs.
 *  2. DESTROY on the spawner, per the mode — its own pin dropped first, so
 *     a container a refused destroy leaves behind is reaped like any other.
 *  3. SETTLE — the claimed rows read destroyed, and the deletion is
 *     audited. Only the rows the claim took: a turn after the claim starts
 *     a fresh incarnation under the same id (its create waits for this
 *     destroy), and that one is not this deletion's to settle.
 *
 * A busy, offline or failed spawner call leaves the claimed rows `expired`:
 * nothing resumes them, and the next attempt finds the workspace again.
 */
export async function retireWorkspace(
  sql: Sql,
  args: RetireWorkspaceArgs,
  spawner: WorkspaceSpawner = DEFAULT_SPAWNER,
): Promise<WorkspaceRetireOutcome> {
  const organizationId = args.organizationId;
  if (organizationId === null) {
    return destroyOnSpawner(args.sessionId, args.mode, spawner);
  }
  const session = { organizationId, sessionId: args.sessionId };
  return withSessionLifecycleLock(sql, session, async (sessionSql) => {
    const claim = await claimWorkspace(sessionSql, args, organizationId);
    if (claim === 'kept' || claim === 'busy') return claim;
    // The ended incarnation's credentials go at once, like an expiry's: a
    // gateway key has no TTL of its own. A key the gateway could not
    // delete is handed back to the settlement reconcile, which retries it.
    await revokeSessionGatewayKeys(sessionSql, session).catch(
      (error: unknown) => {
        console.error(
          `[sandbox.cleanup] gateway key reclaim for ${args.sessionId} failed:`,
          error,
        );
      },
    );
    if (claim.unpinned) {
      await spawner.unpin(args.sessionId).catch((error: unknown) => {
        console.warn(
          `[sandbox.cleanup] dropping the spawner's pin of ${args.sessionId} failed:`,
          error,
        );
      });
    }
    const outcome = await destroyOnSpawner(args.sessionId, args.mode, spawner);
    if (pending(outcome)) return outcome;
    if (claim.rowIds.length > 0) {
      await sessionSql`
        UPDATE app.sandbox_sessions SET
          status = 'destroyed', destroyed_at_ms = ${Date.now()}
        WHERE org_id = ${organizationId} AND id = ANY(${claim.rowIds})
          AND status <> 'destroyed'
      `;
    }
    await auditRetired(sessionSql, organizationId, args, outcome);
    return outcome;
  });
}

async function claimWorkspace(
  sql: Sql,
  args: RetireWorkspaceArgs,
  organizationId: string,
): Promise<'kept' | 'busy' | { rowIds: string[]; unpinned: boolean }> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, organizationId);
    if (args.eligible !== undefined && !(await args.eligible(tx))) {
      return 'kept';
    }
    const rows = await tx<{ id: string; status: string; pinned: boolean }[]>`
      SELECT id, status, pinned FROM app.sandbox_sessions
      WHERE org_id = ${organizationId} AND session_id = ${args.sessionId}
        AND status <> 'destroyed'
      FOR UPDATE
    `;
    const live = rows.filter((row) => LIVE_STATUSES.has(row.status));
    if (args.mode === 'stopped') {
      if (live.some((row) => row.status !== 'stopped')) return 'busy';
      if (live.some((row) => row.pinned)) return 'kept';
    }
    if (args.mode === 'idle') {
      const running = await tx<{ running: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM app.sandbox_session_ops
          WHERE org_id = ${organizationId} AND session_id = ${args.sessionId}
            AND status = 'running'
        ) AS running
      `;
      if (running[0]?.running ?? false) return 'busy';
    }
    await tx`
      UPDATE app.sandbox_sessions SET
        status = 'expired', pinned = false, pinned_at_ms = NULL
      WHERE org_id = ${organizationId} AND session_id = ${args.sessionId}
        AND status IN ('creating', 'active', 'degraded', 'stopped')
    `;
    return {
      rowIds: rows.map((row) => row.id),
      unpinned: live.some((row) => row.pinned),
    };
  });
}

async function destroyOnSpawner(
  sessionId: string,
  mode: WorkspaceDestroyMode,
  spawner: WorkspaceSpawner,
): Promise<WorkspaceRetireOutcome> {
  try {
    const result = await spawner.destroy(sessionId, mode);
    if (result.busy) return 'busy';
    return result.destroyed ? 'destroyed' : 'absent';
  } catch (error) {
    if (error instanceof SandboxDeviceOfflineError) return 'offline';
    console.warn(`[sandbox.cleanup] destroying ${sessionId} failed:`, error);
    return 'failed';
  }
}

async function auditRetired(
  sql: Sql,
  organizationId: string,
  args: RetireWorkspaceArgs,
  outcome: WorkspaceRetireOutcome,
): Promise<void> {
  try {
    await sql.begin((tx) =>
      createAuditLog(tx, {
        organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'sandbox_workspace.deleted',
        category: 'data',
        resourceType: 'sandbox_workspace',
        resourceId: args.sessionId,
        status: 'success',
        metadata: {
          reason: args.reason,
          // `absent`: the spawner held nothing under the id any more.
          workspaceFound: outcome === 'destroyed',
          ...args.detail,
        },
      }),
    );
  } catch (error) {
    // The workspace is gone either way; a lost audit row must not turn the
    // deletion into a retry that finds nothing.
    console.error(
      `[sandbox.cleanup] audit of ${args.sessionId}'s deletion failed:`,
      error,
    );
  }
}

// --- deciding what may go ---------------------------------------------------

/** What the cleanup reads about one workspace of one organization. */
export interface WorkspaceFacts {
  ownerType: string;
  ownerId: string;
  /** A row still holds compute (creating, active, degraded). */
  inUse: boolean;
  /** A live row is pinned ("always-on"). */
  pinned: boolean;
  /** A queued or running task run is about to work in it. */
  runQueued: boolean;
  /** project_agent: the agent still exists. */
  agentExists: boolean;
  /** project_agent: a workspace of one person's runs (not the standing
   * one), and that person is no longer a member of the organization. */
  memberLeft: boolean;
  /** workflow_run: the run's status, `null` when the run is gone. */
  runStatus: string | null;
  runEndedAt: number | null;
  /** The newest sign of use: a row's creation or resume, an operation's
   * start, heartbeat or end, a task run's start. */
  lastUsedAt: number;
}

export type WorkspaceVerdict =
  | { retire: false }
  | {
      retire: true;
      reason: WorkspaceRetireReason;
      mode: WorkspaceDestroyMode;
    };

/** What a verdict weighs besides the workspace's own facts. */
export interface VerdictContext {
  now: number;
  policy: SandboxWorkspacesConfig;
  /** When the organization's unused-workspace rule, in its current form,
   * took effect (`app.sandbox_workspace_retention`): nothing goes for being
   * unused before a full window has passed since. */
  unusedRuleSince: number;
}

/**
 * Whether a workspace may go, and why. Owner first: a deleted agent's
 * workspace, or the workspace of a member who left, goes even while pinned
 * or warm (only a running exec holds it, at the spawner) — the sweep's
 * backstop to the jobs those deletions queue. Otherwise anything in use,
 * pinned or about to be used stays;
 * a live agent's workspace goes once unused past the organization's window —
 * and never before a full window has passed since that rule took effect, so
 * an upgrade, a rule turned on or a shortened window never takes a workspace
 * nobody had the window to use or pin; an automation run's goes once the run
 * has ended (and the watchdog's own reclaim window passed); anything else
 * nothing owns.
 */
export function workspaceVerdict(
  facts: WorkspaceFacts,
  context: VerdictContext,
): WorkspaceVerdict {
  const keep: WorkspaceVerdict = { retire: false };
  if (facts.ownerType === 'project_agent' && !facts.agentExists) {
    return { retire: true, reason: 'agent_deleted', mode: 'idle' };
  }
  if (facts.ownerType === 'project_agent' && facts.memberLeft) {
    return { retire: true, reason: 'member_removed', mode: 'idle' };
  }
  if (facts.inUse || facts.pinned || facts.runQueued) return keep;
  if (facts.ownerType === 'project_agent') {
    const { deleteUnused, unusedDays } = context.policy;
    const horizon = context.now - unusedDays * DAY_MS;
    return deleteUnused &&
      facts.lastUsedAt < horizon &&
      context.unusedRuleSince <= horizon
      ? { retire: true, reason: 'unused', mode: 'stopped' }
      : keep;
  }
  if (facts.ownerType === 'workflow_run' && facts.runStatus !== null) {
    if (!TERMINAL_RUN_STATUSES.has(facts.runStatus)) return keep;
    if ((facts.runEndedAt ?? 0) > context.now - ENDED_RUN_GRACE_MS) {
      return keep;
    }
  }
  return { retire: true, reason: 'orphaned', mode: 'stopped' };
}

/** The facts of one organization's workspace, or `null` when no row of the
 * organization names it. */
async function readWorkspaceFacts(
  sql: Sql | TransactionSql,
  organizationId: string,
  sessionId: string,
): Promise<WorkspaceFacts | null> {
  const rows = await sql<
    {
      ownerType: string;
      ownerId: string;
      inUse: boolean;
      pinned: boolean;
      runQueued: boolean;
      agentExists: boolean;
      runStatus: string | null;
      runEndedAt: number | null;
      lastUsedAt: number | null;
    }[]
  >`
    WITH incarnations AS (
      SELECT status, owner_type, owner_id, pinned, created_at_ms,
             last_activity_at_ms, id
      FROM app.sandbox_sessions
      WHERE org_id = ${organizationId} AND session_id = ${sessionId}
    ), latest AS (
      SELECT owner_type, owner_id FROM incarnations
      ORDER BY created_at_ms DESC, id DESC
      LIMIT 1
    )
    SELECT
      l.owner_type AS "ownerType", l.owner_id AS "ownerId",
      EXISTS (
        SELECT 1 FROM incarnations
        WHERE status IN ('creating', 'active', 'degraded')
      ) AS "inUse",
      EXISTS (
        SELECT 1 FROM incarnations
        WHERE pinned AND status IN ('creating', 'active', 'degraded', 'stopped')
      ) AS "pinned",
      EXISTS (
        SELECT 1 FROM app.project_agent_runs r
        WHERE r.org_id = ${organizationId} AND r.session_id = ${sessionId}
          AND r.status IN ('queued', 'running')
      ) AS "runQueued",
      EXISTS (
        SELECT 1 FROM app.project_agents a
        WHERE a.org_id = ${organizationId} AND a.id = l.owner_id
      ) AS "agentExists",
      r.status AS "runStatus",
      coalesce(r.finished_at_ms, r.started_at_ms)::float8 AS "runEndedAt",
      greatest(
        (SELECT max(greatest(created_at_ms, coalesce(last_activity_at_ms, 0)))
         FROM incarnations),
        (SELECT max(greatest(op.started_at_ms, coalesce(op.heartbeat_at_ms, 0),
                             coalesce(op.last_event_at_ms, 0),
                             coalesce(op.finished_at_ms, 0)))
         FROM app.sandbox_session_ops op
         WHERE op.org_id = ${organizationId} AND op.session_id = ${sessionId}),
        (SELECT max(greatest(pr.started_at_ms, coalesce(pr.launched_at_ms, 0)))
         FROM app.project_agent_runs pr
         WHERE pr.org_id = ${organizationId} AND pr.session_id = ${sessionId})
      )::float8 AS "lastUsedAt"
    FROM latest l
    LEFT JOIN app.automation_runs r
      ON l.owner_type = 'workflow_run' AND r.org_id = ${organizationId}
        AND r.id = split_part(l.owner_id, ':', 1)
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const memberLeft =
    row.ownerType === 'project_agent' &&
    row.agentExists &&
    !isStandingProjectAgentSession(row.ownerId, sessionId) &&
    (await runsStarterLeft(sql, organizationId, sessionId));
  return { ...row, memberLeft, lastUsedAt: row.lastUsedAt ?? 0 };
}

/**
 * Whether every run in a member's workspace was started by one person who
 * is no longer a member. The workspace's id is derived from that person and
 * never names them, so its runs do; a workspace of a schedule's runs (one
 * that may not act in the project gets its own the same way), or one whose
 * runs are all gone, is no member's and is never taken for one.
 */
async function runsStarterLeft(
  sql: Sql | TransactionSql,
  organizationId: string,
  sessionId: string,
): Promise<boolean> {
  const starters = await sql<{ startedBy: string }[]>`
    SELECT DISTINCT started_by AS "startedBy" FROM app.project_agent_runs
    WHERE org_id = ${organizationId} AND session_id = ${sessionId}
  `;
  const people = new Set(
    starters.map((starter) => runStarterUserId(starter.startedBy)),
  );
  const [person] = people;
  if (people.size !== 1 || person === undefined || person === null) {
    return false;
  }
  return !(await isMember(sql, organizationId, person));
}

/** Per-organization inputs of one sweep: its policy, its holds, and the
 * member workspaces its custodian holds keep. Read once per organization.
 * `record` stamps when the unused-workspace rule took effect; the decision
 * taken again under a claim's lock only reads it, so a claim writes nothing
 * before the rows it locks (an organization's deletion takes the same rows
 * the other way round). */
class OrganizationContext {
  private readonly cache = new Map<
    string,
    Promise<{
      exists: boolean;
      policy: SandboxWorkspacesConfig;
      unusedRuleSince: number;
      holds: ActiveHolds;
      heldSessions: Set<string>;
    }>
  >();

  constructor(
    private readonly sql: Sql | TransactionSql,
    private readonly now: number,
    private readonly record: boolean,
  ) {}

  get(organizationId: string) {
    let entry = this.cache.get(organizationId);
    if (entry === undefined) {
      entry = this.load(organizationId);
      this.cache.set(organizationId, entry);
    }
    return entry;
  }

  private async load(organizationId: string) {
    const exists = await organizationExists(this.sql, organizationId);
    const read = exists
      ? await readWorkspacesPolicy(this.sql, organizationId)
      : DEFAULT_SANDBOX_WORKSPACES;
    // A policy that could not be read keeps every unused workspace this
    // round and leaves the rule's record alone: a passing failure must not
    // start its window over. A deleted organization's rule is not recorded
    // either: its workspaces go as orphans, never for being unused.
    const policy = read ?? {
      ...DEFAULT_SANDBOX_WORKSPACES,
      deleteUnused: false,
    };
    let unusedRuleSince = this.now;
    if (exists && read !== null) {
      unusedRuleSince = this.record
        ? await recordUnusedWorkspaceRule(
            this.sql,
            organizationId,
            policy,
            // When the rule is first seen, not when the sweep began.
            Math.max(this.now, Date.now()),
          )
        : await readUnusedRuleSince(this.sql, organizationId, policy, this.now);
    }
    const holds = await loadActiveHolds(this.sql, organizationId);
    const heldSessions = await heldMemberSessions(
      this.sql,
      organizationId,
      holds.userMembershipIds,
    );
    return { exists, policy, unusedRuleSince, holds, heldSessions };
  }
}

async function organizationExists(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "organization" WHERE "id" = ${organizationId}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/** The organization's `sandbox_workspaces` policy: its defaults when the file
 * is missing, `null` when it cannot be read — which deletes nothing for being
 * unused this round, and must not stop the cleanup of owner-less workspaces. */
async function readWorkspacesPolicy(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<SandboxWorkspacesConfig | null> {
  try {
    return (
      (await readGovernancePolicyForOrg(
        sql,
        organizationId,
        'sandbox_workspaces',
      )) ?? DEFAULT_SANDBOX_WORKSPACES
    );
  } catch (error) {
    console.warn(
      `[sandbox.cleanup] reading the sandbox_workspaces policy of ${organizationId} failed; its unused workspaces are kept this round:`,
      error,
    );
    return null;
  }
}

/** The workspaces a custodian hold keeps: every held member's workspace with
 * every agent that has one in the organization. The member is not recorded
 * on the session row — the id is derived from agent and member — so it is
 * derived the same way here. */
async function heldMemberSessions(
  sql: Sql | TransactionSql,
  organizationId: string,
  heldUserIds: ReadonlySet<string>,
): Promise<Set<string>> {
  const held = new Set<string>();
  if (heldUserIds.size === 0) return held;
  for (const agentId of await agentsWithWorkspaces(sql, organizationId)) {
    for (const userId of heldUserIds) {
      held.add(memberSessionIdForProjectAgent(agentId, userId));
    }
  }
  return held;
}

async function agentsWithWorkspaces(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<string[]> {
  const rows = await sql<{ agentId: string }[]>`
    SELECT DISTINCT owner_id AS "agentId" FROM app.sandbox_sessions
    WHERE org_id = ${organizationId} AND owner_type = 'project_agent'
  `;
  return rows.map((row) => row.agentId);
}

/** Held: the organization is on hold, or the workspace is a held member's. */
function heldBack(
  context: { holds: ActiveHolds; heldSessions: Set<string> },
  sessionId: string,
): boolean {
  return context.holds.orgHeld || context.heldSessions.has(sessionId);
}

/** Judge one workspace of one organization now, as the sweep does — or
 * `null` when nothing is to be done. */
async function judge(
  sql: Sql | TransactionSql,
  organizations: OrganizationContext,
  organizationId: string,
  sessionId: string,
  now: number,
): Promise<{
  verdict: Extract<WorkspaceVerdict, { retire: true }>;
  facts: WorkspaceFacts;
} | null> {
  const context = await organizations.get(organizationId);
  if (heldBack(context, sessionId)) return null;
  const facts = await readWorkspaceFacts(sql, organizationId, sessionId);
  if (facts === null) return null;
  const verdict = workspaceVerdict(facts, {
    now,
    policy: context.policy,
    unusedRuleSince: context.unusedRuleSince,
  });
  return verdict.retire ? { verdict, facts } : null;
}

/**
 * When each of these hibernated project-agent workspaces is deleted for being
 * unused, as the sweep would decide it now: its last use plus the
 * organization's window, and no earlier than a window after the rule took
 * effect — never earlier than now, since a sweep runs hourly.
 * Absent for a workspace the policy never deletes: in use, pinned, about to
 * be used, held, its agent gone (that one is on its way already), or the
 * organization keeps unused workspaces.
 */
export async function unusedWorkspaceDeletions(
  sql: Sql,
  organizationId: string,
  sessionIds: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, number>> {
  const deletions = new Map<string, number>();
  if (sessionIds.length === 0) return deletions;
  const policy = await readWorkspacesPolicy(sql, organizationId);
  if (policy === null || !policy.deleteUnused) return deletions;
  const holds = await loadActiveHolds(sql, organizationId);
  if (holds.orgHeld) return deletions;
  const since = await readUnusedRuleSince(sql, organizationId, policy, now);
  const held = await heldMemberSessions(
    sql,
    organizationId,
    holds.userMembershipIds,
  );
  for (const sessionId of sessionIds) {
    if (held.has(sessionId)) continue;
    const facts = await readWorkspaceFacts(sql, organizationId, sessionId);
    if (
      facts === null ||
      facts.ownerType !== 'project_agent' ||
      !facts.agentExists ||
      facts.memberLeft ||
      facts.inUse ||
      facts.pinned ||
      facts.runQueued
    ) {
      continue;
    }
    deletions.set(
      sessionId,
      Math.max(
        now,
        Math.max(facts.lastUsedAt, since) + policy.unusedDays * DAY_MS,
      ),
    );
  }
  return deletions;
}

/** Whose a workspace no row names is, as far as this deployment can tell from
 * the organization the spawner attributes it to. */
export type LeftoverOwner =
  /** An organization of this deployment. */
  | 'ours'
  /** An organization this deployment deleted. */
  | 'deleted'
  /** An organization this deployment never held: another deployment's. */
  | 'foreign'
  /** None the spawner can name (a hibernated Docker workspace). */
  | 'unknown';

export interface LeftoverFacts {
  sessionId: string;
  owner: LeftoverOwner;
  /** A project agent's workspace whose agent still exists here. */
  agentExists: boolean;
}

/**
 * Whether a workspace no row names is this deployment's leftover to delete.
 * A spawner, or a Kubernetes namespace, may hold another deployment's
 * workspaces too, and no row here names those either — so only what is
 * attributable goes: a crawler render's, which is torn down within its
 * render wherever it ran (a day-old one is nobody's), and one of an
 * organization this deployment deleted or holds. Never a project agent's
 * whose agent still exists: a restored database lost its row, and the
 * agent's next run resumes the files under the same id.
 */
export function leftoverVerdict(facts: LeftoverFacts): boolean {
  if (facts.sessionId.startsWith('rnd-')) return true;
  if (facts.owner === 'deleted') return true;
  return facts.owner === 'ours' && !facts.agentExists;
}

async function readLeftoverFacts(
  sql: Sql | TransactionSql,
  workspace: { sessionId: string; organizationId?: string | undefined },
): Promise<LeftoverFacts> {
  const { sessionId, organizationId } = workspace;
  if (organizationId === undefined) {
    return { sessionId, owner: 'unknown', agentExists: false };
  }
  if (!(await organizationExists(sql, organizationId))) {
    return {
      sessionId,
      owner: (await deletedByThisDeployment(sql, organizationId))
        ? 'deleted'
        : 'foreign',
      agentExists: false,
    };
  }
  let agentLives = false;
  if (sessionId.startsWith('pa-')) {
    const agents = await sql<{ id: string }[]>`
      SELECT id FROM app.project_agents WHERE org_id = ${organizationId}
    `;
    agentLives = agents.some((agent) =>
      isProjectAgentSession(agent.id, sessionId),
    );
  }
  return { sessionId, owner: 'ours', agentExists: agentLives };
}

/** Whether any row of the organization names the session — decided again
 * under the admission lock before a leftover of it goes. */
async function sessionNamed(
  sql: Sql | TransactionSql,
  organizationId: string,
  sessionId: string,
): Promise<boolean> {
  const rows = await sql<{ named: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.sandbox_sessions
      WHERE org_id = ${organizationId} AND session_id = ${sessionId}
    ) AS named
  `;
  return rows[0]?.named ?? true;
}

// --- the hourly sweep -------------------------------------------------------

export interface WorkspaceCleanupOptions {
  spawner?: WorkspaceSpawner;
  signal?: AbortSignal;
  now?: number;
  retireLimit?: number;
  /** Sweep one organization only: its rows' workspaces, and of the
   * workspaces no row names only those the spawner attributes to it. */
  organizationId?: string;
}

export interface WorkspaceCleanupResult {
  /** Workspaces deleted, by reason. */
  retired: Partial<Record<WorkspaceRetireReason, number>>;
  /** Workspaces left for a later sweep (busy, offline, failed). */
  deferred: number;
  /** Workspaces no row names that the cleanup cannot attribute to this
   * deployment — another deployment's, or one the spawner cannot name an
   * organization for — and leaves alone. */
  unattributed: number;
  /** Deleted organizations whose remaining resources were torn down. */
  organizations: number;
  /** Whether the spawner's inventory was read this sweep. */
  inventory: 'read' | 'unsupported' | 'unavailable';
}

/**
 * One sweep, in three passes:
 *
 *  1. OWNED — every project-agent workspace the rows name whose latest
 *     incarnation has not been destroyed: a deleted agent's goes, a live
 *     agent's goes once unused past its organization's window.
 *  2. INVENTORY — every workspace the spawner holds that no live row owns
 *     any more: an ended run's whose reclaim never came (its row healed as
 *     destroyed while the host kept the directory), and of the ones no row
 *     names only this deployment's ({@link leftoverVerdict}) — a cut-off
 *     render's, one of an organization it deleted. A workspace touched
 *     within {@link WORKSPACE_CLEANUP_GRACE_MS}, active or pinned is skipped
 *     outright.
 *  3. ORGANIZATIONS — the build caches and package caches the spawner still
 *     holds for an organization this deployment deleted.
 *
 * Bounded by `retireLimit` deletions, {@link SWEEP_ATTEMPTS_PER_RETIRE}
 * times as many attempts per pass, and the job's signal; whatever is left
 * waits for the next sweep, which walks in another order.
 */
export async function runWorkspaceCleanup(
  sql: Sql,
  options: WorkspaceCleanupOptions = {},
): Promise<WorkspaceCleanupResult> {
  const spawner = options.spawner ?? DEFAULT_SPAWNER;
  const now = options.now ?? Date.now();
  const limit = options.retireLimit ?? SWEEP_RETIRE_LIMIT;
  const organizations = new OrganizationContext(sql, now, true);
  const result: WorkspaceCleanupResult = {
    retired: {},
    deferred: 0,
    unattributed: 0,
    organizations: 0,
    inventory: 'unavailable',
  };
  // Deletions are bounded across the sweep, attempts per pass: workspaces
  // that keep refusing (a device offline for weeks, a destroy that keeps
  // failing) cost a bounded share of each pass, and every sweep walks in
  // an order of its own, so they never hold the rest back.
  let deletions = 0;
  let attempts = 0;
  const attemptLimit = limit * SWEEP_ATTEMPTS_PER_RETIRE;
  const exhausted = () =>
    deletions >= limit ||
    attempts >= attemptLimit ||
    options.signal?.aborted === true;
  const retire = async (args: RetireWorkspaceArgs) => {
    attempts += 1;
    const outcome = await retireWorkspace(sql, args, spawner);
    if (pending(outcome)) result.deferred += 1;
    if (outcome === 'destroyed' || outcome === 'absent') {
      deletions += 1;
      result.retired[args.reason] = (result.retired[args.reason] ?? 0) + 1;
    }
  };
  const rotation = String(Math.floor(now / HOUR_MS));

  // 1. OWNED
  const scope = options.organizationId ?? null;
  const owned = await sql<{ organizationId: string; sessionId: string }[]>`
    SELECT "organizationId", "sessionId" FROM (
      SELECT DISTINCT ON (org_id, session_id)
        org_id AS "organizationId", session_id AS "sessionId", status
      FROM app.sandbox_sessions
      WHERE owner_type = 'project_agent'
        AND (${scope}::text IS NULL OR org_id = ${scope})
      ORDER BY org_id, session_id, created_at_ms DESC, id DESC
    ) latest
    WHERE status <> 'destroyed'
    ORDER BY md5("sessionId" || ${rotation})
  `;
  for (const { organizationId, sessionId } of owned) {
    if (exhausted()) break;
    const judged = await judge(
      sql,
      organizations,
      organizationId,
      sessionId,
      now,
    );
    if (judged === null) continue;
    await retire({
      organizationId,
      sessionId,
      reason: judged.verdict.reason,
      mode: judged.verdict.mode,
      eligible: async (tx) => {
        const again = await judge(
          tx,
          new OrganizationContext(tx, now, false),
          organizationId,
          sessionId,
          now,
        );
        return again?.verdict.reason === judged.verdict.reason;
      },
      detail: { lastUsedAt: judged.facts.lastUsedAt },
    });
  }

  // 2. INVENTORY
  let inventory: SandboxWorkspaceInventory | null;
  try {
    inventory = await spawner.inventory();
  } catch (error) {
    console.warn(
      '[sandbox.cleanup] the spawner inventory is unavailable; owner-less workspaces wait for the next sweep:',
      error,
    );
    return result;
  }
  if (inventory === null) {
    result.inventory = 'unsupported';
    return result;
  }
  result.inventory = 'read';
  attempts = 0;
  const order = new Map(
    inventory.workspaces.map((workspace) => [
      workspace.sessionId,
      createHash('sha256')
        .update(`${rotation}:${workspace.sessionId}`)
        .digest('hex'),
    ]),
  );
  const walk = [...inventory.workspaces].sort((a, b) =>
    (order.get(a.sessionId) ?? '').localeCompare(order.get(b.sessionId) ?? ''),
  );
  for (const workspace of walk) {
    if (exhausted()) break;
    if (workspace.active || workspace.pinned) continue;
    if (workspace.touchedAtMs > now - WORKSPACE_CLEANUP_GRACE_MS) continue;
    const owners = await sql<{ organizationId: string }[]>`
      SELECT DISTINCT org_id AS "organizationId" FROM app.sandbox_sessions
      WHERE session_id = ${workspace.sessionId}
    `;
    if (owners.length === 0) {
      if (scope !== null && workspace.organizationId !== scope) continue;
      const leftover = await readLeftoverFacts(sql, workspace);
      if (!leftoverVerdict(leftover)) {
        if (leftover.owner === 'foreign' || leftover.owner === 'unknown') {
          result.unattributed += 1;
        }
        continue;
      }
      // One of this deployment's organizations: its holds keep it, and it is
      // decided again under its lock and audited there. Otherwise nobody
      // here answers for it (a deleted organization had no hold to keep).
      const organizationId =
        leftover.owner === 'ours' ? (workspace.organizationId ?? null) : null;
      if (
        organizationId !== null &&
        heldBack(await organizations.get(organizationId), workspace.sessionId)
      ) {
        continue;
      }
      await retire({
        organizationId,
        sessionId: workspace.sessionId,
        reason: 'orphaned',
        mode: 'stopped',
        eligible: async (tx) =>
          organizationId === null ||
          (!(await sessionNamed(tx, organizationId, workspace.sessionId)) &&
            !(await loadActiveHolds(tx, organizationId)).orgHeld),
      });
      continue;
    }
    if (
      scope !== null &&
      !owners.some((owner) => owner.organizationId === scope)
    ) {
      continue;
    }
    for (const { organizationId } of owners) {
      if (scope !== null && organizationId !== scope) continue;
      const judged = await judge(
        sql,
        organizations,
        organizationId,
        workspace.sessionId,
        now,
      );
      if (judged === null) continue;
      await retire({
        organizationId,
        sessionId: workspace.sessionId,
        reason: judged.verdict.reason,
        // Nothing runs under an inactive workspace: only a stopped one goes.
        mode: 'stopped',
        eligible: async (tx) => {
          const again = await judge(
            tx,
            new OrganizationContext(tx, now, false),
            organizationId,
            workspace.sessionId,
            now,
          );
          return again?.verdict.reason === judged.verdict.reason;
        },
        detail: { lastUsedAt: judged.facts.lastUsedAt },
      });
      break;
    }
  }

  // 3. ORGANIZATIONS
  for (const organizationId of inventory.organizations) {
    if (options.signal?.aborted === true) break;
    if (scope !== null && organizationId !== scope) continue;
    if (!(await deletedByThisDeployment(sql, organizationId))) continue;
    try {
      if ((await spawner.teardownOrganization(organizationId)) !== null) {
        result.organizations += 1;
      }
    } catch (error) {
      console.warn(
        `[sandbox.cleanup] teardown of deleted organization ${organizationId} failed; the next sweep retries:`,
        error,
      );
    }
  }
  return result;
}

/**
 * An organization the spawner holds resources for that this deployment
 * deleted: gone from `organization`, and either still tombstoned or recorded
 * as deleted in the audit trail (which outlives the organization). Another
 * deployment's organization on a shared Docker daemon is neither, and is
 * never touched.
 */
async function deletedByThisDeployment(
  sql: Sql,
  organizationId: string,
): Promise<boolean> {
  const rows = await sql<{ deleted: boolean }[]>`
    SELECT NOT EXISTS (
        SELECT 1 FROM "organization" WHERE "id" = ${organizationId}
      ) AND (
        EXISTS (
          SELECT 1 FROM app.organization_tombstones
          WHERE org_id = ${organizationId}
        ) OR EXISTS (
          SELECT 1 FROM app.audit_logs
          WHERE org_id = ${organizationId} AND action = 'organization_deleted'
        )
      ) AS deleted
  `;
  return rows[0]?.deleted ?? false;
}

// --- the owner's deletion ---------------------------------------------------

export type RetireWorkspacesPayload = TaskPayloads['sandbox.retire_workspaces'];

/**
 * The `sandbox.retire_workspaces` job: delete the workspaces of deleted
 * agents, or of a member who left. Idempotent — every decision is re-read —
 * and THROWS while a workspace is busy, offline or its spawner call failed,
 * so the queue's backoff retries it; the hourly sweep is the backstop past
 * the queue's last retry.
 */
export async function retireOwnerWorkspaces(
  sql: Sql,
  payload: RetireWorkspacesPayload,
  spawner: WorkspaceSpawner = DEFAULT_SPAWNER,
): Promise<{ retired: number; kept: number }> {
  const { organizationId } = payload;
  const holds = await loadActiveHolds(sql, organizationId);
  if (holds.orgHeld) {
    console.warn(
      `[sandbox.cleanup] ${organizationId} is on legal hold; its workspaces stay`,
    );
    return { retired: 0, kept: 0 };
  }
  let targets: Array<{
    sessionId: string;
    eligible: RetireWorkspaceArgs['eligible'];
  }>;
  let reason: WorkspaceRetireReason;
  if (payload.reason === 'member_removed') {
    reason = 'member_removed';
    if (holds.userMembershipIds.has(payload.userId)) {
      console.warn(
        `[sandbox.cleanup] a legal hold keeps the workspaces of ${payload.userId} in ${organizationId}`,
      );
      return { retired: 0, kept: 0 };
    }
    const sessionIds = await memberWorkspaces(
      sql,
      organizationId,
      payload.userId,
    );
    targets = sessionIds.map((sessionId) => ({
      sessionId,
      // Re-added meanwhile: the workspace is theirs again.
      eligible: async (tx) =>
        !(await isMember(tx, organizationId, payload.userId)) &&
        !(await heldAgain(tx, organizationId, payload.userId)),
    }));
  } else {
    reason = 'agent_deleted';
    const rows = await sql<{ sessionId: string; agentId: string }[]>`
      SELECT session_id AS "sessionId", min(owner_id) AS "agentId"
      FROM app.sandbox_sessions
      WHERE org_id = ${organizationId} AND owner_type = 'project_agent'
        AND owner_id = ANY(${payload.agentIds})
      GROUP BY session_id
      HAVING bool_or(status <> 'destroyed')
    `;
    targets = rows.map(({ sessionId, agentId }) => ({
      sessionId,
      eligible: async (tx) =>
        !(await agentExists(tx, organizationId, agentId)) &&
        !(await agentWorkspaceHeld(tx, organizationId, agentId, sessionId)),
    }));
  }
  let retired = 0;
  let kept = 0;
  let waiting = 0;
  for (const target of targets) {
    const outcome = await retireWorkspace(
      sql,
      {
        organizationId,
        sessionId: target.sessionId,
        reason,
        mode: 'idle',
        eligible: target.eligible,
      },
      spawner,
    );
    if (pending(outcome)) waiting += 1;
    else if (outcome === 'kept') kept += 1;
    else retired += 1;
  }
  if (waiting > 0) {
    throw new Error(
      `${waiting} workspace(s) of ${organizationId} could not be deleted yet (busy, offline or unreachable); retrying`,
    );
  }
  return { retired, kept };
}

/** A member's workspaces with the organization's agents. By default only
 * the ones a row may still hold a workspace for; `settled: true` adds the
 * ones whose rows all read destroyed, for an erasure that must also reach a
 * directory a healed row left behind. */
async function memberWorkspaces(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
  options: { settled?: boolean } = {},
): Promise<string[]> {
  const candidates = (await agentsWithWorkspaces(sql, organizationId)).map(
    (agentId) => memberSessionIdForProjectAgent(agentId, userId),
  );
  if (candidates.length === 0) return [];
  const rows = await sql<{ sessionId: string }[]>`
    SELECT session_id AS "sessionId" FROM app.sandbox_sessions
    WHERE org_id = ${organizationId} AND owner_type = 'project_agent'
      AND session_id = ANY(${candidates})
    GROUP BY session_id
    HAVING ${options.settled === true} OR bool_or(status <> 'destroyed')
  `;
  return rows.map((row) => row.sessionId);
}

async function isMember(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql<{ member: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "member"
      WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    ) AS member
  `;
  return rows[0]?.member ?? false;
}

async function agentExists(
  sql: Sql | TransactionSql,
  organizationId: string,
  agentId: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.project_agents
      WHERE org_id = ${organizationId} AND id = ${agentId}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/** A hold placed since the job was queued: on the organization, or on the
 * member whose workspaces these are. */
async function heldAgain(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const holds = await loadActiveHolds(sql, organizationId);
  return holds.orgHeld || holds.userMembershipIds.has(userId);
}

/** A hold that keeps a deleted agent's workspace, as the sweep's would: on
 * the organization, or on the member whose own workspace with the agent it
 * is. The member is not on the row — the id is derived from agent and member,
 * so it is matched the same way. */
async function agentWorkspaceHeld(
  sql: Sql | TransactionSql,
  organizationId: string,
  agentId: string,
  sessionId: string,
): Promise<boolean> {
  const holds = await loadActiveHolds(sql, organizationId);
  if (holds.orgHeld) return true;
  for (const userId of holds.userMembershipIds) {
    if (memberSessionIdForProjectAgent(agentId, userId) === sessionId) {
      return true;
    }
  }
  return false;
}

/**
 * The erasure cascade's pass: delete every workspace the subject's runs with
 * an agent worked in, whatever runs there — the data is theirs, and the
 * erasure receipt must be true. THROWS when one could not be deleted, which
 * the cascade records as a failed pass (the receipt reads partial and a
 * Retry runs it again).
 */
export async function eraseMemberWorkspaces(
  sql: Sql,
  args: { organizationId: string; userId: string },
  spawner: WorkspaceSpawner = DEFAULT_SPAWNER,
): Promise<number> {
  let erased = 0;
  const failed: string[] = [];
  for (const sessionId of await memberWorkspaces(
    sql,
    args.organizationId,
    args.userId,
    { settled: true },
  )) {
    const outcome = await retireWorkspace(
      sql,
      {
        organizationId: args.organizationId,
        sessionId,
        reason: 'member_erased',
        mode: 'force',
        eligible: async (tx) =>
          !(await heldAgain(tx, args.organizationId, args.userId)),
      },
      spawner,
    );
    if (outcome === 'destroyed' || outcome === 'absent') erased += 1;
    else failed.push(`${sessionId} (${outcome})`);
  }
  if (failed.length > 0) {
    throw new Error(`workspaces not erased: ${failed.join(', ')}`);
  }
  return erased;
}

export type RetireOrganizationPayload =
  TaskPayloads['sandbox.retire_organization'];

/**
 * The `sandbox.retire_organization` job, in the order that keeps every step
 * reachable: the gateway keys minted for the organization's sessions are
 * revoked first (a key has no TTL of its own, and spends against providers
 * nobody answers for any more); then its workspaces are destroyed, whatever
 * runs in them — the organization is gone. An organization with a long
 * history is split over several jobs, and the last one alone lets the hub go
 * of its devices and removes what the spawner still holds for it — once its
 * own workspaces and every other slice's are gone, since a device's
 * workspaces are reachable only while the hub still knows where they live.
 * Every step is idempotent; the job THROWS until all of them have succeeded,
 * so the queue's backoff retries, and the hourly sweep's inventory is the
 * backstop past its last retry.
 */
export async function retireOrganizationSandboxes(
  payload: RetireOrganizationPayload,
  deps: {
    spawner?: WorkspaceSpawner;
    /** How many of the organization's other slices have yet to finish. */
    otherSlicesPending: () => Promise<number>;
  },
): Promise<void> {
  const spawner = deps.spawner ?? DEFAULT_SPAWNER;
  const failures: string[] = [];
  for (const keyId of payload.gatewayKeyIds) {
    try {
      await spawner.revokeKey(keyId);
    } catch (error) {
      console.error(
        `[sandbox.cleanup] revoking gateway key ${keyId} of deleted organization ${payload.organizationId} failed:`,
        error,
      );
      failures.push(`key ${keyId}`);
    }
  }
  for (const sessionId of payload.sessionIds) {
    const outcome = await destroyOnSpawner(sessionId, 'force', spawner);
    if (pending(outcome)) failures.push(`${sessionId} (${outcome})`);
  }
  const finishing = payload.teardown || payload.deviceIds.length > 0;
  if (finishing && failures.length === 0) {
    const others = await deps.otherSlicesPending();
    if (others > 0) failures.push(`${others} other slice(s) still running`);
  }
  if (finishing && failures.length === 0) {
    for (const deviceId of payload.deviceIds) {
      try {
        await spawner.disconnectDevice(deviceId);
      } catch (error) {
        console.warn(
          `[sandbox.cleanup] the hub has not let go of device ${deviceId} yet:`,
          error,
        );
        failures.push(`device ${deviceId}`);
      }
    }
  }
  if (payload.teardown && failures.length === 0) {
    try {
      await spawner.teardownOrganization(payload.organizationId);
    } catch (error) {
      console.warn(
        `[sandbox.cleanup] teardown of ${payload.organizationId} on the spawner failed:`,
        error,
      );
      failures.push('spawner teardown');
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `sandbox teardown of deleted organization ${payload.organizationId} incomplete: ${failures.join(', ')}`,
    );
  }
}

/** The organization's other retirement slices still queued, retrying or
 * running — every one but the last, which alone carries `teardown`. */
export async function pendingOrganizationSlices(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ pending: number }[]>`
    SELECT count(*)::int AS pending FROM pgboss.job
    WHERE name = 'sandbox.retire_organization'
      AND data ->> 'organizationId' = ${organizationId}
      AND NOT coalesce((data ->> 'teardown')::boolean, false)
      AND state IN ('created', 'retry', 'active')
  `;
  return rows[0]?.pending ?? 0;
}
