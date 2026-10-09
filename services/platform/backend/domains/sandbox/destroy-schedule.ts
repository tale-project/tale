import type { Sql, TransactionSql } from 'postgres';

import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { lockOrgAdmission } from './admission-lock.ts';

/**
 * The Sandboxes page's Destroy, scheduled. The request queues a
 * `sandbox.destroy_session` job and answers; the job runs the teardown
 * (`teardownSession`): the session's lifecycle lock, the unpin on both
 * sides, the spawner's delete, the settled row. That chain can wait minutes
 * behind a pinned recreate holding the lock, and the spawner deletes a large
 * workspace slowly, so no request waits on it.
 *
 * The teardown stays one step under the lock rather than ending the row
 * early and leaving only the delete to the job: a turn that started while
 * that delete was still queued would open a fresh incarnation over the very
 * files the delete is about to remove.
 *
 * Each job names the row it was asked for. A session id is deterministic
 * (a project agent's is the same for every incarnation), so a retry that
 * finds a newer row under it leaves that one alone (`teardownSession`).
 *
 * The page reads the queue back for each row: a Destroy of that row still
 * queued, retrying or running reads `pending`, and one whose every attempt
 * failed reads `failed` until the next one is asked for.
 *
 * A pending Destroy also closes its row to new work: the admission verbs
 * (`reserveSessionSlot`, `resumeSessionSlot`) refuse the session while
 * {@link sessionDestroyPending} holds. A turn let in between two attempts
 * would resume the very incarnation the next attempt deletes, over files a
 * failed attempt may already have removed. Once the Destroy has settled —
 * the row destroyed, or every attempt failed — admission opens again.
 */

export type SandboxDestroyState = 'pending' | 'failed';

const DESTROY_JOB = 'sandbox.destroy_session';

/** pg-boss states of a job that has not finished yet. */
const UNFINISHED_JOB_STATES: ReadonlySet<string> = new Set([
  'created',
  'retry',
  'active',
]);

interface SessionArgs {
  organizationId: string;
  sessionId: string;
}

/**
 * Queue the Destroy of one of the organization's sessions: of its latest
 * incarnation, the one the teardown reads. False when the organization holds
 * no such row, or it is already destroyed, so nothing is queued for another
 * organization's session or for one already gone. A Destroy of the same row
 * already queued or running absorbs this one.
 *
 * Under the organization's admission lock, which every reserve and resume
 * takes: a turn admitted before the request is a turn the Destroy cancels,
 * and every one after it is refused until the Destroy has settled.
 */
export async function scheduleSessionDestroy(
  sql: Sql,
  args: SessionArgs,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    await lockOrgAdmission(tx, args.organizationId);
    const rows = await tx<{ id: string; status: string }[]>`
      SELECT id, status FROM app.sandbox_sessions
      WHERE org_id = ${args.organizationId} AND session_id = ${args.sessionId}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined || row.status === 'destroyed') return false;
    await addJobInTx(
      tx,
      DESTROY_JOB,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        rowId: row.id,
      },
      {
        singletonKey: JSON.stringify([
          args.organizationId,
          args.sessionId,
          row.id,
        ]),
      },
    );
    return true;
  });
}

/**
 * Whether a Destroy is queued, retrying or running for a live row under the
 * session id — the `pending` the page reads. With `rowId`, only a Destroy of
 * that row counts. The admission verbs read it under the organization's
 * admission lock: a Destroy for an incarnation already settled says nothing
 * about a fresh one under the same id, and one whose every attempt failed
 * no longer holds the row.
 */
export async function sessionDestroyPending(
  tx: TransactionSql | Sql,
  args: SessionArgs & { rowId?: string },
): Promise<boolean> {
  const rowId = args.rowId ?? null;
  const rows = await tx<{ pending: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pgboss.job j
      JOIN app.sandbox_sessions s
        ON s.id::text = j.data ->> 'rowId' AND s.org_id = ${args.organizationId}
      WHERE j.name = ${DESTROY_JOB}
        AND j.state::text = ANY(${[...UNFINISHED_JOB_STATES]})
        AND j.data ->> 'organizationId' = ${args.organizationId}
        AND s.session_id = ${args.sessionId}
        AND s.status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
        AND (${rowId}::text IS NULL OR s.id::text = ${rowId})
    ) AS pending
  `;
  return rows[0]?.pending ?? false;
}

/**
 * Each listed session's destroy state, from the latest Destroy job asked for
 * the row it lists now. A job for an earlier incarnation under the same id
 * says nothing about a fresh workspace the id names today.
 */
export async function sessionDestroyStates(
  sql: Sql | TransactionSql,
  organizationId: string,
  sessionIds: readonly string[],
): Promise<Map<string, SandboxDestroyState>> {
  const states = new Map<string, SandboxDestroyState>();
  if (sessionIds.length === 0) return states;
  const jobs = await sql<{ sessionId: string; state: string }[]>`
    SELECT DISTINCT ON (s.session_id)
      s.session_id AS "sessionId", j.state::text AS state
    FROM pgboss.job j
    JOIN app.sandbox_sessions s
      ON s.id::text = j.data ->> 'rowId' AND s.org_id = ${organizationId}
    WHERE j.name = ${DESTROY_JOB}
      AND j.data ->> 'organizationId' = ${organizationId}
      AND s.session_id = ANY(${[...sessionIds]})
      AND s.status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
    ORDER BY s.session_id, j.created_on DESC
  `;
  for (const job of jobs) {
    if (UNFINISHED_JOB_STATES.has(job.state)) {
      states.set(job.sessionId, 'pending');
    } else if (job.state === 'failed') {
      states.set(job.sessionId, 'failed');
    }
  }
  return states;
}
