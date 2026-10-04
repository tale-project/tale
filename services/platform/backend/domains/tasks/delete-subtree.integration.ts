import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { archiveTask, createTask, deleteTask } from './service.ts';

export async function checkTaskSubtreeDeletion(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const { orgId, userId } = ctx;
  const auth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const projectId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Deep deletion proof', ${userId}, ${now}, ${now})
  `;
  const ids: string[] = [];
  for (let depth = 0; depth < 35; depth += 1) {
    ids.push(
      await transactSerializable(sql, (tx) =>
        createTask(tx, auth, {
          projectId,
          title: `Depth ${depth}`,
          parentTaskId: ids.at(-1),
          status: depth === 33 ? 'done' : 'todo',
        }),
      ),
    );
  }
  const rootId = ids[0];
  const deepestId = ids.at(-1);
  if (rootId === undefined || deepestId === undefined) {
    throw new Error('The deep chain was not created');
  }
  await transactSerializable(sql, (tx) => archiveTask(tx, auth, deepestId));
  const survivorId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Keep this root',
      status: 'todo',
    }),
  );
  const threadId = randomUUID();
  const messageId = randomUUID();
  const reviewId = randomUUID();
  const agentRunId = randomUUID();
  const automationRunId = randomUUID();
  const blobRef = `s3:itest-deep-delete-${randomUUID()}`;
  const sharedRef = `s3:itest-deep-shared-${randomUUID()}`;
  await sql`
    INSERT INTO app.threads (id, org_id, kind, created_at_ms, updated_at_ms)
    VALUES (${threadId}, ${orgId}, 'task_discussion', ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.messages (id, thread_id, org_id, "order", role, text, created_at_ms)
    VALUES (${messageId}, ${threadId}, ${orgId}, 0, 'user', 'Deep discussion', ${now})
  `;
  await sql`
    UPDATE app.tasks SET discussion_thread_id = ${threadId},
      attachments = ${sql.json(toJson([{ fileId: sharedRef }]))},
      outputs = ${sql.json(toJson([{ fileId: blobRef }]))}
    WHERE id = ${deepestId}
  `;
  await sql`
    UPDATE app.tasks SET attachments = ${sql.json(toJson([{ fileId: sharedRef }]))}
    WHERE id = ${survivorId}
  `;
  for (const ref of [blobRef, sharedRef]) {
    await sql`
      INSERT INTO app.file_metadata (org_id, storage_ref, file_name, content_type,
        size, lifecycle_status, created_at_ms)
      VALUES (${orgId}, ${ref}, 'proof.txt', 'text/plain', 1, 'active', ${now})
    `;
  }
  await sql`
    INSERT INTO app.approvals (id, org_id, resource_type, resource_id, status, created_at_ms)
    VALUES (${reviewId}, ${orgId}, 'task_review', ${deepestId}, 'pending', ${now})
  `;
  await sql`
    INSERT INTO app.project_agent_runs (id, org_id, project_id, task_id, agent_id,
      exec_id, session_id, status, harness, model, started_by, started_at_ms,
      deadline_at_ms, updated_at_ms)
    VALUES (${agentRunId}, ${orgId}, ${projectId}, ${deepestId}, ${randomUUID()},
      ${randomUUID()}, ${randomUUID()}, 'queued', 'claude-code', 'itest-model',
      ${`user:${userId}`}, ${now}, ${now + 60_000}, ${now})
  `;
  await sql`
    INSERT INTO app.automation_runs (id, org_id, project_id, name, version,
      status, mode, started_by, started_at_ms, input)
    VALUES (${automationRunId}, ${orgId}, ${projectId}, 'itest-deep-delete', 1,
      'waiting', 'live', ${`user:${userId}`}, ${now},
      ${sql.json(toJson({ task: { id: deepestId } }))})
  `;

  const result = await transactSerializable(sql, (tx) =>
    deleteTask(tx, auth, rootId),
  );
  const remaining = await sql<{ id: string; parentId: string | null }[]>`
    SELECT id, parent_task_id AS "parentId" FROM app.tasks WHERE project_id = ${projectId}
  `;
  const counts = await sql<{ open: number; done: number }[]>`
    SELECT open_task_count AS open, done_task_count AS done
    FROM app.projects WHERE id = ${projectId}
  `;
  const audits = await sql<
    { metadata: { deletedChildCount: number; cancelledRunCount: number } }[]
  >`
    SELECT metadata FROM app.audit_logs
    WHERE resource_id = ${rootId} AND action = 'task.deleted'
  `;
  record(
    'task delete: all 34 descendants beyond depth 32 retire without an orphan root',
    result.deletedChildCount === 34 &&
      remaining.length === 1 &&
      remaining[0]?.id === survivorId &&
      remaining[0].parentId === null &&
      counts[0]?.open === 1 &&
      counts[0].done === 0 &&
      audits[0]?.metadata.deletedChildCount === 34,
    JSON.stringify({ result, remaining, counts, audits }),
  );
  const threads = await sql`SELECT id FROM app.threads WHERE id = ${threadId}`;
  const messages =
    await sql`SELECT id FROM app.messages WHERE id = ${messageId}`;
  const reviews = await sql<{ status: string; reason: string }[]>`
    SELECT status, metadata->>'closedReason' AS reason FROM app.approvals WHERE id = ${reviewId}
  `;
  const agentRuns =
    await sql`SELECT id FROM app.project_agent_runs WHERE id = ${agentRunId}`;
  const automationRuns = await sql<{ status: string }[]>`
    SELECT status FROM app.automation_runs WHERE id = ${automationRunId}
  `;
  const ledger = await sql<{ finalStatus: string }[]>`
    SELECT metadata->>'finalStatus' AS "finalStatus" FROM app.audit_logs
    WHERE resource_id = ${agentRunId} AND action = 'agent.run_settled'
  `;
  const files = await sql<{ ref: string; status: string }[]>`
    SELECT storage_ref AS ref, lifecycle_status AS status FROM app.file_metadata
    WHERE org_id = ${orgId} AND storage_ref = ANY(${[blobRef, sharedRef]})
  `;
  const releaseJobs = await sql<{ data: { refs: string[] } }[]>`
    SELECT data FROM pgboss.job WHERE name = 'knowledge.release_refs'
      AND data->>'organizationId' = ${orgId}
      AND data->'refs' @> ${sql.json([blobRef])}::jsonb
  `;
  record(
    'task delete: deep discussions, runs, reviews and exclusive files retire; shared files stay',
    threads.length === 0 &&
      messages.length === 0 &&
      agentRuns.length === 0 &&
      ledger[0]?.finalStatus === 'cancelled' &&
      reviews[0]?.status === 'rejected' &&
      reviews[0].reason === 'task_deleted' &&
      automationRuns[0]?.status === 'cancelled' &&
      audits[0]?.metadata.cancelledRunCount === 2 &&
      files.find((file) => file.ref === blobRef)?.status === 'trashed' &&
      files.find((file) => file.ref === sharedRef)?.status === 'active' &&
      releaseJobs.length === 1 &&
      !releaseJobs[0]?.data.refs.includes(sharedRef),
    JSON.stringify({
      threads,
      messages,
      reviews,
      agentRuns,
      ledger,
      automationRuns,
      files,
      releaseJobs,
    }),
  );

  const cyclicIds: string[] = [];
  for (let depth = 0; depth < 3; depth += 1) {
    cyclicIds.push(
      await transactSerializable(sql, (tx) =>
        createTask(tx, auth, {
          projectId,
          title: `Cycle ${depth}`,
          parentTaskId: cyclicIds.at(-1),
        }),
      ),
    );
  }
  const cycleRoot = cyclicIds[0];
  const cycleLeaf = cyclicIds.at(-1);
  if (cycleRoot === undefined || cycleLeaf === undefined)
    throw new Error('No cycle fixture');
  cyclicIds.push(
    await transactSerializable(sql, (tx) =>
      createTask(tx, auth, {
        projectId,
        title: 'Cycle branch',
        parentTaskId: cycleRoot,
      }),
    ),
  );
  await sql`UPDATE app.tasks SET parent_task_id = ${cycleLeaf} WHERE id = ${cycleRoot}`;
  const cycleResult = await transactSerializable(sql, async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    return deleteTask(tx, auth, cycleRoot);
  });
  const cycleRemaining =
    await sql`SELECT id FROM app.tasks WHERE id = ANY(${cyclicIds})`;
  record(
    'task delete: corrupt cycles terminate and each descendant counts once',
    cycleResult.deletedChildCount === 3 && cycleRemaining.length === 0,
    JSON.stringify({ cycleResult, cycleRemaining }),
  );
  const singleResult = await transactSerializable(sql, (tx) =>
    deleteTask(tx, auth, survivorId),
  );
  record(
    'task delete: a leaf reports no deleted children',
    singleResult.deletedChildCount === 0,
    JSON.stringify(singleResult),
  );
}
