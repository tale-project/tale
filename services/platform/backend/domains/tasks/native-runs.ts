import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { messagePartsToTimeline } from '../../../lib/agent/transcript.ts';
import type { MessagePart } from '../../../lib/chat/types.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createThread } from '../threads/store.ts';
import { saveAgentFileMetadata } from './agent-file-metadata.ts';
import {
  type AgentRunHandoff,
  emitTaskRunHint,
  type TaskAgentRunSandboxOp,
} from './agent-runs.ts';
import { queuedOnTask } from './comments.ts';
import { agentRecordTaskOutputsTrusted } from './service.ts';

/**
 * The database side of a run that executes on the native engine: its
 * transcript thread, the files it made, and the hand-over to the harness.
 * The turn itself is `native-turn.ts`; the run's own lifecycle — launch,
 * settle, fail, cancel — is the one every run shares (`agent-runs.ts`,
 * `agent-run-completion.ts`).
 */

/** The `app.threads.kind` of a run's transcript thread. Such a thread has no
 * `thread_metadata` row, so no chat list ever shows it: it is read through
 * the task, by the people who can read the task. */
export const TASK_RUN_THREAD_KIND = 'task_run';

/** A file a native run made, as a task's outputs keep it. */
export interface RunFile {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/**
 * Open the run's transcript thread and point the run at it, in one
 * transaction — once, for the exec that owns the run. The thread belongs to
 * the person the run acts for, like a chat they started. Returns `null` when
 * this exec no longer owns a running run, or the run already has a thread.
 */
export async function attachRunThread(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    execId: string;
    userId: string;
    title: string;
  },
): Promise<string | null> {
  return sql.begin(async (tx) => {
    const live = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agent_runs
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND exec_id = ${args.execId} AND status = 'running'
        AND engine = 'native' AND thread_id IS NULL
      FOR UPDATE
    `;
    if (live.length === 0) return null;
    const threadId = await createThread(tx, {
      organizationId: args.organizationId,
      userId: args.userId,
      title: args.title,
      kind: TASK_RUN_THREAD_KIND,
    });
    await tx`
      UPDATE app.project_agent_runs SET
        thread_id = ${threadId}, updated_at_ms = ${Date.now()}
      WHERE id = ${args.runId}
    `;
    return threadId;
  });
}

/**
 * The files the run's tools made, oldest first, one per name: a file the
 * model revised after making it is its last version, as a reply's file cards
 * show it and as a task's outputs keep it (a deliverable of the same name
 * replaces the earlier one).
 */
export async function listRunFiles(
  sql: Sql | TransactionSql,
  args: { organizationId: string; threadId: string },
): Promise<RunFile[]> {
  const rows = await sql<
    {
      fileId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }[]
  >`
    SELECT storage_ref AS "fileId", file_name AS "fileName",
           content_type AS "fileType", size::float8 AS "fileSize"
    FROM app.file_metadata
    WHERE org_id = ${args.organizationId} AND thread_id = ${args.threadId}
      AND source IN ('agent', 'task-output')
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
    ORDER BY created_at_ms, id
  `;
  const byName = new Map<string, RunFile>();
  for (const row of rows) {
    // Re-inserted last, so the map's order stays the order they were made.
    byName.delete(row.fileName);
    byName.set(row.fileName, row);
  }
  return [...byName.values()];
}

/**
 * Move the run to the harness. Two doors lead here. A native pass hands the
 * run over when the work needs a repository, a browser or hours
 * (`use_workspace`): the files the pass made become the task's deliverables,
 * so the harness — which stages them as the task's current outputs — carries
 * on from them, with the reason and the brief the pass wrote for its
 * successor. And a run the engine cannot serve (an agent with connectors or
 * secrets, a run no person started) is routed to the harness before anything
 * ran, with neither.
 *
 * The run flips to the harness engine and back to `queued` under a fresh exec,
 * and the harness's start job takes it from there, exactly as it takes any
 * run. Fenced on the exec that owns the run, so a pass that lost the run (a
 * stop, a steer) moves nothing. Returns the exec the harness start runs
 * under, or `null`.
 */
export async function moveRunToHarnessInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    execId: string;
    handoff?: AgentRunHandoff;
    files?: readonly RunFile[];
  },
): Promise<string | null> {
  const run = (
    await tx<{ taskId: string; projectId: string }[]>`
      SELECT task_id AS "taskId", project_id AS "projectId"
      FROM app.project_agent_runs
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND exec_id = ${args.execId} AND engine = 'native'
        AND status IN ('queued', 'running')
      LIMIT 1
    `
  )[0];
  if (run === undefined) return null;
  return queuedOnTask(tx, run.taskId, async () => {
    // The run is taken first, as every writer of a run and its task does.
    const owned = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agent_runs
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND exec_id = ${args.execId} AND engine = 'native'
        AND status IN ('queued', 'running')
      FOR UPDATE
    `;
    if (owned.length === 0) return null;
    const files = args.files ?? [];
    for (const file of files) {
      await saveAgentFileMetadata(tx, {
        organizationId: args.organizationId,
        storageId: file.fileId,
        fileName: file.fileName,
        contentType: file.fileType,
        size: file.fileSize,
        source: 'task-output',
      });
    }
    await agentRecordTaskOutputsTrusted(tx, {
      organizationId: args.organizationId,
      taskId: run.taskId,
      runId: args.runId,
      files: [...files],
    });
    const execId = randomUUID();
    await tx`
      UPDATE app.project_agent_runs SET
        engine = 'harness', status = 'queued', exec_id = ${execId},
        handoff = ${args.handoff === undefined ? null : tx.json(toJson(args.handoff))},
        updated_at_ms = ${Date.now()}
      WHERE id = ${args.runId}
    `;
    await addJobInTx(tx, 'task.agent_turn', {
      organizationId: args.organizationId,
      runId: args.runId,
      execId,
    });
    await emitTaskRunHint(tx, {
      organizationId: args.organizationId,
      taskId: run.taskId,
    });
    return execId;
  });
}

/** The op status a run's own status reads as on the run card. */
function opStatusOf(runStatus: string): string {
  switch (runStatus) {
    case 'settled':
      return 'completed';
    case 'failed':
    case 'cancelled':
      return runStatus;
    default:
      return 'running';
  }
}

/**
 * What a native run is doing, in the wire the run card reads for a harness
 * run's live transcript: the run's transcript thread, mapped. `null` when
 * the run is not a native one or has not opened its transcript yet — the
 * card then shows what it shows for a run with nothing to say.
 */
export async function readNativeRunOp(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<TaskAgentRunSandboxOp | null> {
  const runs = await sql<
    {
      execId: string;
      status: string;
      threadId: string | null;
      model: string;
      modelProvider: string | null;
      startedAt: number;
      launchedAt: number | null;
      settledAt: number | null;
      updatedAt: number;
    }[]
  >`
    SELECT exec_id AS "execId", status, thread_id AS "threadId", model,
           model_provider AS "modelProvider",
           started_at_ms::float8 AS "startedAt",
           launched_at_ms::float8 AS "launchedAt",
           settled_at_ms::float8 AS "settledAt",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.project_agent_runs
    WHERE id = ${runId} AND org_id = ${organizationId} AND engine = 'native'
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined || run.threadId === null) return null;
  const replies = await sql<{ parts: unknown; text: string | null }[]>`
    SELECT parts, text FROM app.messages
    WHERE thread_id = ${run.threadId} AND org_id = ${organizationId}
      AND role = 'assistant'
    ORDER BY "order" DESC, step_order DESC
    LIMIT 1
  `;
  const reply = replies[0];
  const settled: MessagePart[] = Array.isArray(reply?.parts)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the turn store writes parts in this shape only
      (reply.parts as MessagePart[])
    : [];
  // The text of the round streaming now is not in the parts yet: it rides
  // the turn's generation row until the round settles.
  const live = await sql<{ text: string }[]>`
    SELECT text FROM app.generations
    WHERE thread_id = ${run.threadId} AND org_id = ${organizationId}
  `;
  const progressText = live[0]?.text ?? '';
  const timeline = messagePartsToTimeline(settled);
  return {
    execId: run.execId,
    status: opStatusOf(run.status),
    ...(progressText !== '' ? { progressText } : {}),
    ...(timeline.length > 0 ? { liveTimeline: timeline } : {}),
    modelRef:
      run.modelProvider !== null
        ? `${run.modelProvider}/${run.model}`
        : run.model,
    startedAt: run.launchedAt ?? run.startedAt,
    ...(run.settledAt !== null ? { finishedAt: run.settledAt } : {}),
    lastEventAt: run.settledAt ?? run.updatedAt,
  };
}
