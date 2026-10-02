/** Local HTTP and real-Postgres routing proof. Source runs are inert settled
 * fixtures; this lane starts no agent, changes no grant and calls no provider. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  type SetTaskReviewerInput,
  taskReviewerFromIds,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import {
  deleteProjectAgent,
  getProjectAuthContext,
  setProjectTaskReviewer,
} from '../projects/service.ts';
import {
  fixtures,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import { getPendingReviewForTask, requestTaskReview } from './reviews.ts';
import {
  getTaskReviewer,
  loadTaskOrThrow,
  setTaskReviewer,
  updateTask,
  updateTaskStatus,
} from './service.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function refusal(work: () => Promise<unknown>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    return isRecord(error) && typeof error.code === 'string'
      ? error.code
      : String(error);
  }
}

function latch() {
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release: () => release?.() };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Review routing race barrier timed out')),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A barrier on an actual database response; every query and SQL helper is
 * forwarded unchanged, including the SERIALIZABLE retry on the loser. */
function observeTaskRead(tx: TransactionSql, read: () => void): TransactionSql {
  return new Proxy(tx, {
    apply(target, thisArg, args: unknown[]) {
      const result: unknown = Reflect.apply(target, thisArg, args);
      const parts = args[0];
      if (
        Array.isArray(parts) &&
        'raw' in parts &&
        parts.join('?').trim().startsWith('SELECT') &&
        parts.join('?').includes('FROM app.tasks')
      ) {
        return Promise.resolve(result).then((rows) => {
          read();
          return rows;
        });
      }
      return result;
    },
  });
}

export async function checkAgentTaskReviewRouting(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const fx = fixtures(sql, ctx);
  const project = randomUUID();
  const neighbor = randomUUID();
  const author = randomUUID();
  const reviewer = randomUUID();
  const outsider = randomUUID();
  const starter = `review-author-${fx.suffix}`;
  const member = `review-member-${fx.suffix}`;
  const auth = await getProjectAuthContext(sql, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
  });
  const state = (taskId: string) => getTaskReviewer(sql, auth, taskId);
  const json = async (path: string, body?: unknown) => {
    const url = new URL(`${base}/api/app/${path}`);
    url.searchParams.set('orgId', ctx.orgId);
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: ctx.cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value: unknown = await response.json();
    return { status: response.status, body: isRecord(value) ? value : {} };
  };
  const expectation = async (
    taskId: string,
  ): Promise<SetTaskReviewerInput['expected']> => {
    const current = await state(taskId);
    const pending = current.pendingReview;
    return {
      reviewer: current.reviewer,
      pendingReview:
        pending === null
          ? null
          : {
              approvalId: pending.approvalId,
              runId: pending.runId,
              reviewer: pending.reviewer,
            },
    };
  };
  const configure = (reviewerId: string | null, expectedId: string | null) =>
    transactSerializable(sql, (tx) =>
      setProjectTaskReviewer(tx, auth, project, {
        reviewer:
          reviewerId === null
            ? { kind: 'human_default' }
            : { kind: 'agent', agentId: reviewerId },
        expected:
          expectedId === null
            ? { kind: 'human_default' }
            : { kind: 'agent', agentId: expectedId },
      }),
    );
  const submitted = async (title: string, explicitHuman = false) => {
    const taskId = await fx.insertTask({
      projectId: project,
      title,
      status: 'in_review',
      agentId: author,
    });
    const runId = randomUUID();
    await sql`INSERT INTO app.project_agent_runs (id, org_id, project_id, task_id, agent_id, exec_id, session_id, status, harness, model, started_by, started_at_ms, deadline_at_ms, settled_at_ms, updated_at_ms)
      VALUES (${runId}, ${ctx.orgId}, ${project}, ${taskId}, ${author}, ${`review-${runId}`}, ${`pa-${author}`}, 'settled', 'claude-code', 'itest-model', ${starter}, ${fx.now}, ${fx.now + 3_600_000}, ${fx.now}, ${fx.now})`;
    if (explicitHuman)
      await sql`UPDATE app.tasks SET reviewer_user_id = ${ctx.userId} WHERE id = ${taskId}`;
    await transactSerializable(sql, async (tx) =>
      requestTaskReview(tx, {
        task: await loadTaskOrThrow(tx, taskId, ctx.orgId),
        trigger: { kind: 'agent_run', runId },
      }),
    );
    return { taskId, runId };
  };

  try {
    await fx.insertUser(starter, 'editor');
    await fx.insertUser(member, 'member');
    await fx.insertProject(project, 'Agent review routing');
    await fx.insertProject(neighbor, 'Review neighboring project');
    await fx.insertAgent(author, project, 'Implementation');
    await fx.insertAgent(reviewer, project, 'Independent review');
    await fx.insertAgent(outsider, neighbor, 'Other project');
    const legacy = await submitted('Existing human review');
    const original = await state(legacy.taskId);
    record(
      'review routing: migration keeps legacy writes and creator default',
      original.reviewer.kind === 'inherit' &&
        original.projectReviewer.kind === 'human_default' &&
        original.pendingReview?.reviewer?.kind === 'user' &&
        original.pendingReview.reviewer.userId === ctx.userId,
      'old-column INSERT and captured person remain valid',
    );

    const configured = await json(`projects/${project}/task-reviewer`, {
      reviewer: { kind: 'agent', agentId: reviewer },
      expected: { kind: 'human_default' },
    });
    const unchanged = await state(legacy.taskId);
    record(
      'review routing: explicit project opt-in applies only to future reviews',
      configured.status === 200 &&
        unchanged.projectReviewer.kind === 'agent' &&
        unchanged.pendingReview?.approvalId ===
          original.pendingReview?.approvalId &&
        unchanged.pendingReview?.reviewer?.kind === 'user',
      `HTTP ${configured.status}; captured old owner retained`,
    );

    const fresh = await submitted('Inherited agent review');
    const human = await submitted('Explicit human override', true);
    record(
      'review routing: new/import-compatible rows inherit agent while explicit human wins',
      (await state(fresh.taskId)).pendingReview?.reviewer?.kind === 'agent' &&
        (await state(human.taskId)).pendingReview?.reviewer?.kind === 'user',
      'same ordinary review mint, no execution',
    );
    const readback = await json(`tasks/${fresh.taskId}/reviewer`);
    record(
      'review routing: authenticated HTTP read returns configured and captured identities',
      readback.status === 200 &&
        isRecord(readback.body.reviewer) &&
        readback.body.reviewer.kind === 'inherit' &&
        isRecord(readback.body.pendingReview) &&
        readback.body.pendingReview.requestedFor === null &&
        isRecord(readback.body.pendingReview.reviewer) &&
        readback.body.pendingReview.reviewer.agentId === reviewer,
      `HTTP ${readback.status}`,
    );

    const oldExpected = await expectation(legacy.taskId);
    const handed = await json(`tasks/${legacy.taskId}/reviewer`, {
      reviewer: { kind: 'agent', agentId: reviewer },
      expected: oldExpected,
    });
    const after = await state(legacy.taskId);
    const history = await sql<
      {
        id: string;
        status: string;
        metadata: Record<string, unknown>;
        approvedBy: string | null;
      }[]
    >`SELECT id, status, metadata, approved_by AS "approvedBy" FROM app.approvals WHERE org_id = ${ctx.orgId} AND resource_id = ${legacy.taskId} AND resource_type = 'task_review' ORDER BY seq`;
    const taskAfter = await loadTaskOrThrow(sql, legacy.taskId, ctx.orgId);
    record(
      'review routing: explicit handoff preserves source/history/author and never approves',
      handed.status === 200 &&
        history.length === 2 &&
        history[0]?.status === 'rejected' &&
        history[0].metadata.supersededBy === after.pendingReview?.approvalId &&
        history[1]?.status === 'pending' &&
        history[1].approvedBy === null &&
        after.pendingReview?.runId === legacy.runId &&
        taskAfter.status === 'in_review' &&
        taskAfter.assigneeId === author,
      `HTTP ${handed.status}; ${history.length} history rows`,
    );
    const stale = await json(`tasks/${legacy.taskId}/reviewer`, {
      reviewer: { kind: 'user', userId: ctx.userId },
      expected: oldExpected,
    });
    record(
      'review routing: stale handoff rejects with no new history',
      stale.status === 409 &&
        stale.body.error === 'TASK_REVIEWER_STALE' &&
        (await state(legacy.taskId)).pendingReview?.approvalId ===
          after.pendingReview?.approvalId,
      `HTTP ${stale.status}`,
    );
    const oldDone = await refusal(() =>
      transactSerializable(sql, (tx) =>
        updateTaskStatus(tx, auth, legacy.taskId, 'done'),
      ),
    );
    const oldPatch = await refusal(() =>
      transactSerializable(sql, (tx) =>
        updateTask(tx, auth, {
          taskId: legacy.taskId,
          reviewerUserId: ctx.userId,
        }),
      ),
    );
    record(
      'review routing: stale human Done and legacy reviewer edit cannot bypass delegation',
      oldDone === 'TASK_AGENT_REVIEW_REQUIRED' &&
        oldPatch === 'TASK_REVIEWER_HANDOFF_REQUIRED' &&
        (await loadTaskOrThrow(sql, legacy.taskId, ctx.orgId)).status ===
          'in_review',
      `done=${oldDone}, edit=${oldPatch}`,
    );

    const replay = await transactSerializable(sql, async (tx) =>
      requestTaskReview(tx, {
        task: await loadTaskOrThrow(tx, legacy.taskId, ctx.orgId),
        trigger: { kind: 'agent_run', runId: legacy.runId },
      }),
    );
    record(
      'review routing: delayed source settle finds the handoff successor',
      !replay.minted && replay.approvalId === after.pendingReview?.approvalId,
      'no second mint or obsolete approval returned',
    );
    const foreign = await json(`tasks/${human.taskId}/reviewer`, {
      reviewer: { kind: 'agent', agentId: outsider },
      expected: await expectation(human.taskId),
    });
    const self = await json(`tasks/${human.taskId}/reviewer`, {
      reviewer: { kind: 'agent', agentId: author },
      expected: await expectation(human.taskId),
    });
    record(
      'review routing: foreign-project reviewer and source-agent self-review are refused',
      foreign.status === 400 &&
        self.status === 409 &&
        self.body.error === 'TASK_REVIEWER_NOT_INDEPENDENT',
      `foreign=${foreign.status}, self=${self.status}`,
    );
    const memberAuth = await getProjectAuthContext(sql, {
      organizationId: ctx.orgId,
      userId: member,
      role: 'member',
    });
    const memberRefusal = await refusal(async () => {
      const expected = await expectation(human.taskId);
      return transactSerializable(sql, (tx) =>
        setTaskReviewer(tx, memberAuth, human.taskId, {
          reviewer: { kind: 'agent', agentId: reviewer },
          expected,
        }),
      );
    });
    record(
      'review routing: a project reader cannot delegate review ownership',
      memberRefusal === 'RBAC_FORBIDDEN',
      `code=${memberRefusal}`,
    );

    const beforeRollback = await expectation(human.taskId);
    const rollback = await refusal(() =>
      transactSerializable(sql, async (tx) => {
        await setTaskReviewer(tx, auth, human.taskId, {
          reviewer: { kind: 'agent', agentId: reviewer },
          expected: beforeRollback,
        });
        throw new Error('itest: rollback after full routing write');
      }),
    );
    record(
      'review routing: later failure rolls back routing and replacement approval together',
      rollback !== null &&
        JSON.stringify(await expectation(human.taskId)) ===
          JSON.stringify(beforeRollback),
      'original source-bound approval still pending',
    );
    const constraint = await refusal(() =>
      transactSerializable(
        sql,
        (tx) =>
          tx`UPDATE app.tasks SET reviewer_user_id = ${ctx.userId}, reviewer_agent_id = ${reviewer} WHERE id = ${fresh.taskId}`,
      ),
    );
    record(
      'review routing: PostgreSQL forbids simultaneous human and agent overrides',
      constraint === '23514',
      `SQLSTATE=${constraint}`,
    );

    await configure(null, reviewer);
    for (const conversionFirst of [true, false]) {
      const current = await submitted(
        `Race ${conversionFirst ? 'conversion' : 'human'} first`,
      );
      const expected = await expectation(current.taskId);
      const ready = latch();
      const release = latch();
      const seen = latch();
      const convert = (tx: TransactionSql) =>
        setTaskReviewer(tx, auth, current.taskId, {
          reviewer: { kind: 'agent', agentId: reviewer },
          expected,
        });
      const approve = (tx: TransactionSql) =>
        updateTaskStatus(tx, auth, current.taskId, 'done');
      const first = transactSerializable(sql, async (tx) => {
        await (conversionFirst ? convert(tx) : approve(tx));
        ready.release();
        await bounded(release.ready);
      });
      let second: Promise<string | null> | undefined;
      try {
        await bounded(ready.ready);
        second = refusal(() =>
          transactSerializable(sql, async (tx) =>
            conversionFirst
              ? approve(observeTaskRead(tx, seen.release))
              : convert(observeTaskRead(tx, seen.release)),
          ),
        );
        await bounded(seen.ready);
      } finally {
        release.release();
      }
      const results = await bounded(Promise.all([first, second]));
      const final = await loadTaskOrThrow(sql, current.taskId, ctx.orgId);
      record(
        `review routing: real serializable race ${conversionFirst ? 'conversion then human' : 'human then conversion'} has one owner`,
        results[1] ===
          (conversionFirst
            ? 'TASK_AGENT_REVIEW_REQUIRED'
            : 'TASK_REVIEWER_STALE') &&
          final.status === (conversionFirst ? 'in_review' : 'done') &&
          taskReviewerFromIds(final).kind ===
            (conversionFirst ? 'agent' : 'inherit'),
        `loser=${results[1]}, status=${final.status}`,
      );
    }

    const back = await json(`tasks/${legacy.taskId}/reviewer`, {
      reviewer: { kind: 'user', userId: ctx.userId },
      expected: await expectation(legacy.taskId),
    });
    record(
      'review routing: explicit agent-to-human handoff remains pending until a human verdict',
      back.status === 200 &&
        (await state(legacy.taskId)).pendingReview?.reviewer?.kind === 'user' &&
        (await loadTaskOrThrow(sql, legacy.taskId, ctx.orgId)).status ===
          'in_review',
      `HTTP ${back.status}`,
    );
    await configure(reviewer, null);
    await transactSerializable(sql, (tx) =>
      deleteProjectAgent(tx, auth, reviewer),
    );
    const deleted = await state(fresh.taskId);
    record(
      'review routing: deleting reviewer preserves agent-owned wait without creator fallback',
      deleted.projectReviewer.kind === 'agent' &&
        deleted.pendingReview?.reviewer?.kind === 'agent' &&
        deleted.pendingReview.requestedFor === null,
      'routing and captured history survive missing agent',
    );
    const pending = await getPendingReviewForTask(sql, ctx.orgId, fresh.taskId);
    record(
      'review routing: wrong organization cannot read the captured pending review',
      pending !== null &&
        (await getPendingReviewForTask(sql, randomUUID(), fresh.taskId)) ===
          null,
      'org-scoped reader',
    );
  } finally {
    await sql`DELETE FROM app.approvals WHERE org_id = ${ctx.orgId} AND metadata ->> 'projectId' IN ${sql([project, neighbor])}`;
    await sql`DELETE FROM app.projects WHERE id IN ${sql([project, neighbor])} AND org_id = ${ctx.orgId}`;
    await fx.teardownUsers();
  }
}
