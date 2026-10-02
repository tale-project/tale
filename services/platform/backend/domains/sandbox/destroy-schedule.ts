import type { Sql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

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
 * The page reads the queue back for each row: a Destroy still queued,
 * retrying or running reads `pending`, and one whose every attempt failed
 * reads `failed` until the next one is asked for.
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
 * Queue the Destroy of one of the organization's sessions. False when the
 * organization holds no undestroyed row under that id, so nothing is queued
 * for another organization's session or for one already gone. A Destroy
 * already queued or running for the session absorbs this one.
 */
export async function scheduleSessionDestroy(
  sql: Sql,
  args: SessionArgs,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM app.sandbox_sessions
      WHERE org_id = ${args.organizationId} AND session_id = ${args.sessionId}
        AND status <> 'destroyed'
      LIMIT 1
    `;
    if (rows.length === 0) return false;
    await addJobInTx(
      tx,
      DESTROY_JOB,
      { organizationId: args.organizationId, sessionId: args.sessionId },
      { singletonKey: JSON.stringify([args.organizationId, args.sessionId]) },
    );
    return true;
  });
}

/**
 * Each listed session's destroy state, from its latest Destroy job. A failed
 * job counts only when it was asked for after the row's incarnation began:
 * a fresh workspace under a reused id is not the one that failed to go.
 */
export async function sessionDestroyStates(
  sql: Sql,
  organizationId: string,
  sessions: readonly { sessionId: string; createdAt: number }[],
): Promise<Map<string, SandboxDestroyState>> {
  const states = new Map<string, SandboxDestroyState>();
  if (sessions.length === 0) return states;
  const jobs = await sql<
    { sessionId: string; state: string; createdAt: number }[]
  >`
    SELECT DISTINCT ON (data ->> 'sessionId')
      data ->> 'sessionId' AS "sessionId", state::text AS state,
      (EXTRACT(EPOCH FROM created_on) * 1000)::float8 AS "createdAt"
    FROM pgboss.job
    WHERE name = ${DESTROY_JOB}
      AND data ->> 'organizationId' = ${organizationId}
      AND data ->> 'sessionId' = ANY(${sessions.map((session) => session.sessionId)})
    ORDER BY data ->> 'sessionId', created_on DESC
  `;
  const incarnations = new Map(
    sessions.map((session) => [session.sessionId, session.createdAt]),
  );
  for (const job of jobs) {
    if (UNFINISHED_JOB_STATES.has(job.state)) {
      states.set(job.sessionId, 'pending');
    } else if (
      job.state === 'failed' &&
      job.createdAt >= (incarnations.get(job.sessionId) ?? Infinity)
    ) {
      states.set(job.sessionId, 'failed');
    }
  }
  return states;
}
