import { randomUUID } from 'node:crypto';

import {
  isSerializationFailure,
  retryQueueKeysOf,
  transactSerializable,
  type SerializableTransactionRunner,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { TASK_AUDIT_ACTIONS } from '../../core/tasks/audit_actions.ts';
import type { RecordCheck } from '../../integration-lane-helpers.ts';
import {
  addTaskComment,
  orgCommentQueueKey,
  taskCommentQueueKey,
} from './comments.ts';

function signal(): { ready: Promise<void>; release: () => void } {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

/** Force an SSI cycle whose loser has already returned its actual comment.
 * Both transactions read before either writes; the other writer then commits
 * first. PostgreSQL rejects the comment at COMMIT, outside its callback catch.
 * Repeat inside a native savepoint, which has a distinct TransactionSql. */
export async function checkTaskCommentCommitRetry(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  await sql`
    CREATE TABLE itest_comment_commit_retry (id text PRIMARY KEY, value integer NOT NULL)
  `;
  for (const savepoint of [false, true]) {
    const now = Date.now();
    const projectRows = await sql<{ id: string }[]>`
      INSERT INTO app.projects (org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${ctx.orgId}, 'Comment commit retry', ${ctx.userId}, ${now}, ${now})
      RETURNING id
    `;
    const taskRows = await sql<{ id: string }[]>`
      INSERT INTO app.tasks (
        org_id, project_id, title, status, rank, created_by, created_by_type,
        outputs, created_at_ms, updated_at_ms
      ) VALUES (
        ${ctx.orgId}, ${projectRows[0]?.id ?? ''}, 'Comment commit retry', 'todo',
        'q0', ${ctx.userId}, 'user', ${sql.json([])}, ${now}, ${now}
      ) RETURNING id
    `;
    const taskId = taskRows[0]?.id ?? '';
    const firstId = randomUUID();
    const secondId = randomUUID();
    await sql`INSERT INTO itest_comment_commit_retry VALUES (${firstId}, 0), (${secondId}, 0)`;
    const firstRead = signal();
    const secondRead = signal();
    const firstWrote = signal();
    const secondWrote = signal();
    const firstCommitted = signal();
    const first = sql
      .begin('isolation level serializable', async (tx) => {
        await tx`SELECT value FROM itest_comment_commit_retry WHERE id = ${secondId}`;
        firstRead.release();
        await secondRead.ready;
        await tx`UPDATE itest_comment_commit_retry SET value = value + 1 WHERE id = ${firstId}`;
        firstWrote.release();
        await secondWrote.ready;
      })
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        firstRead.release();
        firstWrote.release();
        firstCommitted.release();
      });
    await firstRead.ready;
    let attempts = 0;
    let plainAttempts = 0;
    let reservations = 0;
    let callbackReturned = false;
    let commitFailures = 0;
    let commitKeys: readonly string[] = [];
    const native: SerializableTransactionRunner = sql;
    const begin = native.begin.bind(sql);
    const runner = {
      begin<T>(options: string, callback: (tx: TransactionSql) => Promise<T>) {
        plainAttempts++;
        return begin(options, callback);
      },
      reserve() {
        reservations++;
        return sql.reserve();
      },
    };
    const second = transactSerializable(
      runner,
      async (tx) => {
        attempts++;
        callbackReturned = false;
        await tx`SELECT value FROM itest_comment_commit_retry WHERE id = ${firstId}`;
        if (attempts === 1) {
          secondRead.release();
          await firstWrote.ready;
        }
        const writeComment = (commentTx: TransactionSql) =>
          addTaskComment(
            commentTx,
            {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              role: 'owner',
              teamIds: [],
            },
            { taskId, body: 'Owned commit retry comment' },
          );
        const result = savepoint
          ? await tx.savepoint(writeComment)
          : await writeComment(tx);
        await tx`UPDATE itest_comment_commit_retry SET value = value + 1 WHERE id = ${secondId}`;
        if (attempts === 1) {
          secondWrote.release();
          await firstCommitted.ready;
        }
        callbackReturned = true;
        return result;
      },
      {
        isTransient(error) {
          if (callbackReturned && isSerializationFailure(error)) {
            commitFailures++;
            commitKeys = retryQueueKeysOf(error);
          }
          return isSerializationFailure(error);
        },
      },
    )
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        secondRead.release();
        secondWrote.release();
      });
    const [firstLanded, commentLanded] = await Promise.all([first, second]);
    const rows = await sql<
      { comments: number; messages: string; audits: string }[]
    >`
      SELECT comment_count AS comments,
        (SELECT count(*)::text FROM app.messages WHERE thread_id = discussion_thread_id) AS messages,
        (SELECT count(*)::text FROM app.audit_logs
         WHERE org_id = ${ctx.orgId} AND action = ${TASK_AUDIT_ACTIONS.commentCreated}
           AND metadata ->> 'taskId' = ${taskId}) AS audits
      FROM app.tasks WHERE id = ${taskId}
    `;
    const retained = rows[0];
    record(
      `tasks: a comment rejected at COMMIT retries queued${savepoint ? ' through a native savepoint' : ''}`,
      firstLanded &&
        commentLanded &&
        attempts === 2 &&
        plainAttempts === 1 &&
        reservations === 1 &&
        commitFailures === 1 &&
        JSON.stringify(commitKeys) ===
          JSON.stringify([
            taskCommentQueueKey(taskId),
            orgCommentQueueKey(ctx.orgId),
          ]) &&
        retained?.comments === 1 &&
        retained.messages === '1' &&
        retained.audits === '1',
      `firstLanded=${firstLanded} commentLanded=${commentLanded} attempts=${attempts} plain=${plainAttempts} queued=${reservations} commitFailures=${commitFailures} exactKeys=${JSON.stringify(commitKeys) === JSON.stringify([taskCommentQueueKey(taskId), orgCommentQueueKey(ctx.orgId)])} comments=${retained?.comments} messages=${retained?.messages} audits=${retained?.audits} (want 2 attempts, 1 plain + 1 queued, exact keys and one committed comment/message/audit)`,
    );
  }
}
