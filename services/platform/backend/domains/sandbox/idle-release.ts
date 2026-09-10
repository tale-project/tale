import type { Sql, TransactionSql } from 'postgres';

import {
  sessionReleaseIdle,
  sessionReleaseTicket,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import { lockOrgAdmission } from './admission-lock.ts';

export interface IdleReleaseSession {
  organizationId: string;
  sessionId: string;
}

export type IdleReleaseTicketReader = typeof sessionReleaseTicket;

/** Read-only tickets are captured before the allocation changes. A missing
 * or older runtime simply retains its warm compute until the normal reaper. */
export async function captureIdleReleaseTickets(
  sessions: readonly IdleReleaseSession[],
  readTicket: typeof sessionReleaseTicket = sessionReleaseTicket,
): Promise<Map<string, string>> {
  const tickets = new Map<string, string>();
  if (readTicket === sessionReleaseTicket && !process.env.SANDBOX_TOKEN?.trim())
    return tickets;
  await Promise.all(
    sessions.map(async ({ sessionId }) => {
      try {
        const generation = await readTicket(sessionId);
        if (generation !== null) tickets.set(sessionId, generation);
      } catch (error) {
        console.warn('[sandbox] idle release ticket unavailable:', error);
      }
    }),
  );
  return tickets;
}

/** The job becomes visible only on commit, including a caller's larger
 * cancellation transaction. No runtime eligibility can escape a rollback. */
export async function enqueueIdleSessionReleases(
  tx: TransactionSql | Sql,
  sessions: readonly IdleReleaseSession[],
  tickets: ReadonlyMap<string, string>,
): Promise<void> {
  for (const session of sessions) {
    const generation = tickets.get(session.sessionId);
    if (generation === undefined) continue;
    await addJobInTx(tx, 'sandbox.release_idle', { ...session, generation });
  }
}

/** Workflow terminal doors, the late-settle door and failed-start cleanup
 * share the same release. Terminal cancellation can free the allocation
 * while an exec winds down; runtime eligibility waits for that exec (and
 * the run) to finish. Runs inside the caller's transaction (the run row is
 * already locked there); the org admission lock is taken only around the
 * row update, AFTER the spawner round-trip for the tickets — a ticket read
 * early is safe by the daemon's generation check (a re-acquire in between
 * rotates it and the release job is refused). */
export async function stopWorkflowSessionSlotsInTx(
  tx: TransactionSql | Sql,
  args: { organizationId: string; executionId: string; onlyIdle?: boolean },
  readTicket: typeof sessionReleaseTicket = sessionReleaseTicket,
): Promise<void> {
  // A node session's owner is `<runId>:<node>`; `split_part` matches both the
  // run's own session and its node sessions on the run id — indexable,
  // unlike a `LIKE` on the id prefix.
  const candidates = await tx<IdleReleaseSession[]>`
    SELECT org_id AS "organizationId", session_id AS "sessionId"
    FROM app.sandbox_sessions
    WHERE org_id = ${args.organizationId} AND owner_type = 'workflow_run'
      AND split_part(owner_id, ':', 1) = ${args.executionId}
      AND status IN ('creating', 'active', 'degraded', 'stopped') AND pinned = false
  `;
  const tickets = await captureIdleReleaseTickets(candidates, readTicket);
  await lockOrgAdmission(tx, args.organizationId);
  // Include already-stopped rows: a terminal cancellation's first release
  // may precede op finalization. The post-op hibernate edge must enqueue a
  // fresh ticket once that same allocation is finally idle.
  const released = await tx<IdleReleaseSession[]>`
    UPDATE app.sandbox_sessions s SET status = 'stopped'
    WHERE s.org_id = ${args.organizationId} AND s.owner_type = 'workflow_run'
      AND split_part(s.owner_id, ':', 1) = ${args.executionId}
      AND s.status IN ('creating', 'active', 'degraded', 'stopped') AND s.pinned = false
      AND (${args.onlyIdle === true} = false OR NOT EXISTS (
        SELECT 1 FROM app.sandbox_session_ops op
        WHERE op.session_id = s.session_id AND op.status = 'running'
      ))
      AND (${args.onlyIdle === true} = false OR NOT EXISTS (
        SELECT 1 FROM app.automation_runs r
        WHERE r.org_id = s.org_id AND r.id = split_part(s.owner_id, ':', 1)
          AND r.status NOT IN ('success', 'failed', 'cancelled')
      ))
    RETURNING s.org_id AS "organizationId", s.session_id AS "sessionId"
  `;
  await enqueueIdleSessionReleases(tx, released, tickets);
}

/** Revalidate the committed allocation and owner before the conditional
 * runtime release. A newer acquire invalidates the captured generation even
 * if it races this read. Live owners also cover the gap before exec staging. */
export async function releaseIdleSession(
  sql: Sql,
  args: TaskPayloads['sandbox.release_idle'],
  release: typeof sessionReleaseIdle = sessionReleaseIdle,
): Promise<void> {
  const rows = await sql<{ sessionId: string }[]>`
    SELECT s.session_id AS "sessionId" FROM app.sandbox_sessions s
    WHERE s.org_id = ${args.organizationId} AND s.session_id = ${args.sessionId}
      AND s.status = 'stopped' AND s.pinned = false
      AND NOT EXISTS (
        SELECT 1 FROM app.sandbox_session_ops op
        WHERE op.session_id = s.session_id AND op.status = 'running'
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.project_agent_runs r
        WHERE s.owner_type = 'project_agent' AND r.org_id = s.org_id
          AND r.agent_id = s.owner_id AND r.status IN ('queued', 'running')
          AND r.waiting_for_capacity_at_ms IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.automation_runs r
        WHERE s.owner_type = 'workflow_run' AND r.org_id = s.org_id
          AND r.id = split_part(s.owner_id, ':', 1)
          AND r.status NOT IN ('success', 'failed', 'cancelled')
      )
    LIMIT 1
  `;
  if (rows.length === 0) return;
  await release(args.sessionId, args.generation);
}
