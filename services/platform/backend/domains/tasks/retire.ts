import type { TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { cancelRunInTx } from '../automations/store.ts';
import { cancelAgentRunInTx } from './agent-runs.ts';

/**
 * The ONE retirement walk for a set of tasks that are about to be hard
 * deleted — shared by the task door (`deleteTask`) and the project door
 * (`deleteProject`, whose tasks would otherwise vanish by FK cascade with
 * none of this).
 *
 * Nothing the tasks owned outlives them: their live runs are cancelled in
 * this transaction (the agent run through the ledgered cancel door, so the
 * provenance entry lands before the row goes and the turn host reaps the
 * exec as an orphan; a bound automation run through its own terminal door),
 * their discussion threads are deleted (messages + meta cascade by FK), the
 * pending approvals that named them are REJECTED with a `closedReason` (a
 * reviewer must never be left an inbox row for work that no longer exists —
 * undecidable, because every decision path resolves the task first; rejected
 * rather than deleted so the audit trail keeps the fact that a review was
 * once requested), the task rows are deleted, and their attachment/output
 * blobs are handed to the shared ref-release seam — the tasks' unbound file
 * rows are trashed here and the durable `knowledge.release_refs` job deletes
 * the bytes after commit, keeping any ref another task, document or file row
 * still holds.
 *
 * The caller owns the access gate, the project rollup transitions (moot when
 * the project itself is going) and the audit row.
 */
export interface RetireTasksArgs {
  organizationId: string;
  /** The project every task in `taskIds` belongs to. */
  projectId: string;
  taskIds: string[];
  /** Stamped on each rejected approval's metadata. */
  closedReason: 'task_deleted' | 'project_deleted';
}

export interface RetireTasksResult {
  cancelledRunCount: number;
  releasedRefs: string[];
}

export async function retireTasksInTx(
  tx: TransactionSql,
  args: RetireTasksArgs,
): Promise<RetireTasksResult> {
  const ids = args.taskIds;
  if (ids.length === 0) return { cancelledRunCount: 0, releasedRefs: [] };
  const rows = await tx<
    {
      id: string;
      discussionThreadId: string | null;
      attachments: unknown;
      outputs: unknown;
    }[]
  >`
    SELECT id, discussion_thread_id AS "discussionThreadId", attachments,
           outputs
    FROM app.tasks
    WHERE org_id = ${args.organizationId} AND id = ANY(${ids})
  `;

  // Live runs die WITH their tasks, not after them. The agent run's row
  // would FK-cascade away mid-turn, leaving the sandbox turn executing with
  // nowhere to land and no provenance entry; cancelling it here writes the
  // ledger row first, and the turn host's orphan check reaps the exec. A
  // bound automation run keeps its own terminal contract (audit row,
  // sessions released).
  let cancelledRunCount = 0;
  const liveAgentRuns = await tx<{ id: string; taskId: string }[]>`
    SELECT id, task_id AS "taskId" FROM app.project_agent_runs
    WHERE org_id = ${args.organizationId} AND task_id = ANY(${ids})
      AND status IN ('queued', 'running')
  `;
  for (const run of liveAgentRuns) {
    const cancelled = await cancelAgentRunInTx(tx, {
      organizationId: args.organizationId,
      runId: run.id,
      taskId: run.taskId,
    });
    if (cancelled) cancelledRunCount += 1;
  }
  const liveAutomationRuns = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE org_id = ${args.organizationId} AND project_id = ${args.projectId}
      AND status IN ('queued', 'running', 'waiting')
      AND input -> 'task' ->> 'id' = ANY(${ids})
  `;
  for (const run of liveAutomationRuns) {
    const outcome = await cancelRunInTx(tx, args.organizationId, run.id);
    if (outcome.cancelled) cancelledRunCount += 1;
  }

  // Discussion threads die with their tasks (messages + meta cascade by FK).
  const threadIds = rows
    .map((row) => row.discussionThreadId)
    .filter((id): id is string => id !== null);
  if (threadIds.length > 0) {
    await tx`DELETE FROM app.threads WHERE id = ANY(${threadIds})`;
  }
  await tx`
    UPDATE app.approvals SET
      status = 'rejected', reviewed_at_ms = ${Date.now()},
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('closedReason', ${args.closedReason}::text)
    WHERE org_id = ${args.organizationId} AND status = 'pending'
      AND (
        (resource_type IN ('task_review', 'document_record_review')
          AND resource_id = ANY(${ids}))
        OR metadata->>'taskId' = ANY(${ids})
      )
  `;
  await tx`DELETE FROM app.tasks WHERE id = ANY(${ids})`;

  // Blob reclaim through the shared release seam. A ref some SURVIVING task
  // still lists stays (the same deliverable can sit on two cards); for the
  // rest, the tasks' own unbound file rows are trashed so the release sees
  // them dead, and the durable job deletes the bytes after commit — network
  // I/O never runs inside this transaction, and the release re-checks
  // liveness itself (a document or a chat thread holding the same ref keeps
  // its bytes).
  const releasedRefs = await releaseUnlistedTaskBlobRefs(
    tx,
    args.organizationId,
    collectTaskBlobRefs(rows),
  );
  return { cancelledRunCount, releasedRefs };
}

/**
 * Every blob ref a set of task rows holds — the `fileId` of each
 * attachment/output element (the `s3:` ref both columns carry, the same
 * vocabulary `files/access.ts` reads back), de-duplicated in first-seen
 * order. Malformed elements are skipped: a hard delete must never fail on a
 * row it is about to remove.
 */
export function collectTaskBlobRefs(
  rows: ReadonlyArray<{ attachments: unknown; outputs: unknown }>,
): string[] {
  const refs = new Set<string>();
  for (const row of rows) {
    for (const column of [row.attachments, row.outputs]) {
      if (!Array.isArray(column)) continue;
      for (const element of column) {
        if (
          element !== null &&
          typeof element === 'object' &&
          'fileId' in element &&
          typeof element.fileId === 'string' &&
          element.fileId !== ''
        ) {
          refs.add(element.fileId);
        }
      }
    }
  }
  return [...refs];
}

/**
 * The blob release seam for refs no task row names any more — a hard delete's
 * whole subtree, or the files an edit dropped from a task's attachments.
 * Call it AFTER the row change: a ref some task still lists stays (the same
 * deliverable can sit on two cards); for the rest, the tasks' own unbound
 * file rows are trashed so the release sees them dead, and the durable job
 * deletes the bytes after commit — network I/O never runs inside this
 * transaction, and the release re-checks liveness itself (a document or a
 * chat thread holding the same ref keeps its bytes). Answers the refs it
 * released.
 */
export async function releaseUnlistedTaskBlobRefs(
  tx: TransactionSql,
  organizationId: string,
  refs: readonly string[],
): Promise<string[]> {
  if (refs.length === 0) return [];
  const orphaned = await tx<{ ref: string }[]>`
    SELECT r.ref FROM unnest(${[...refs]}::text[]) AS r(ref)
    WHERE NOT EXISTS (
      SELECT 1 FROM app.tasks t
      WHERE t.org_id = ${organizationId}
        AND (t.outputs @> jsonb_build_array(jsonb_build_object('fileId', r.ref))
             OR t.attachments
                @> jsonb_build_array(jsonb_build_object('fileId', r.ref)))
    )
  `;
  const releasedRefs = orphaned.map((row) => row.ref);
  if (releasedRefs.length > 0) {
    await tx`
      UPDATE app.file_metadata SET
        lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()}
      WHERE org_id = ${organizationId}
        AND storage_ref = ANY(${releasedRefs})
        AND document_id IS NULL AND thread_id IS NULL
        AND conversation_id IS NULL
        AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
    `;
    await addJobInTx(tx, 'knowledge.release_refs', {
      organizationId,
      refs: releasedRefs,
    });
  }
  return releasedRefs;
}
