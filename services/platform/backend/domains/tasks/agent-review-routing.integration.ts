/** Local HTTP and real-Postgres routing proof. Source runs are inert settled
 * fixtures; this lane starts no agent and calls no provider. Grants belong
 * only to its synthetic agents. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  type SetTaskReviewerInput,
  taskReviewerFromIds,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { pgTaskStore } from '../connectors/task-store.ts';
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
import { createNextRepeatCopy } from './repeat.ts';
import { getPendingReviewForTask, requestTaskReview } from './reviews.ts';
import {
  agentUpdateTaskStatusTrusted,
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
  const orgs = await sql<
    { slug: string }[]
  >`SELECT slug FROM "organization" WHERE id = ${ctx.orgId}`;
  const policyDir = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    orgs[0]?.slug ?? '',
    'governance',
  );
  const policyPath = path.join(policyDir, 'review-policy.yml');
  let originalPolicy: string | undefined;
  try {
    originalPolicy = await readFile(policyPath, 'utf8');
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  }
  const setPolicy = async (value: string) => {
    await mkdir(policyDir, { recursive: true });
    await writeFile(policyPath, value);
    clearOrgConfigCaches();
  };
  const state = (taskId: string) => getTaskReviewer(sql, auth, taskId);
  const json = async (route: string, body?: unknown) => {
    const url = new URL(`${base}/api/app/${route}`);
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
      status: 'in_progress',
      agentId: author,
    });
    const runId = randomUUID();
    await sql`INSERT INTO app.project_agent_runs (id, org_id, project_id, task_id, agent_id, exec_id, session_id, status, harness, model, started_by, started_at_ms, deadline_at_ms, settled_at_ms, updated_at_ms)
      VALUES (${runId}, ${ctx.orgId}, ${project}, ${taskId}, ${author}, ${`review-${runId}`}, ${`pa-${author}`}, 'settled', 'claude-code', 'itest-model', ${starter}, ${fx.now}, ${fx.now + 3_600_000}, ${fx.now}, ${fx.now})`;
    if (explicitHuman)
      await sql`UPDATE app.tasks SET reviewer_user_id = ${ctx.userId} WHERE id = ${taskId}`;
    await transactSerializable(sql, async (tx) => {
      // The real settle parks while its claim is live, then marks it settled
      // in the same transaction. No worker can observe this inert run live.
      await tx`UPDATE app.project_agent_runs SET status = 'running' WHERE id = ${runId}`;
      const parked = await agentUpdateTaskStatusTrusted(tx, {
        organizationId: ctx.orgId,
        actorId: author,
        taskId,
        status: 'in_review',
        review: { runId },
      });
      if (!parked.ok)
        throw new Error(`Routing fixture settlement refused: ${parked.reason}`);
      await tx`UPDATE app.project_agent_runs SET status = 'settled' WHERE id = ${runId}`;
    });
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
    const ungrantedProject = await json(`projects/${project}/task-reviewer`, {
      reviewer: { kind: 'agent', agentId: reviewer },
      expected: { kind: 'human_default' },
    });
    record(
      'review routing: project selection refuses a current missing grant',
      ungrantedProject.status === 400 &&
        ungrantedProject.body.error === 'PROJECT_REVIEWER_INVALID',
      `HTTP ${ungrantedProject.status}`,
    );
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review']::text[] WHERE id IN ${sql([author, reviewer])}`;
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
    for (const trigger of ['human', 'automation'] as const) {
      const taskId = await fx.insertTask({
        projectId: project,
        title: `Source-less ${trigger}`,
        agentId: author,
      });
      const result =
        trigger === 'human'
          ? await json(`tasks/${taskId}/status`, { status: 'in_review' })
          : await transactSerializable(sql, (tx) =>
              agentUpdateTaskStatusTrusted(tx, {
                organizationId: ctx.orgId,
                actorId: author,
                taskId,
                status: 'in_review',
              }),
            );
      const read = await json(`tasks/${taskId}/reviewer`);
      const pending = read.body.pendingReview;
      record(
        `review routing: source-less ${trigger} submission stays actionable for a person`,
        read.status === 200 &&
          isRecord(pending) &&
          isRecord(pending.reviewer) &&
          pending.reviewer.kind === 'user' &&
          pending.runId === null &&
          pending.agentReviewBlockedReason === null &&
          ('status' in result ? result.status === 200 : result.ok),
        `read HTTP ${read.status}`,
      );
      const transferred = await json(`tasks/${taskId}/reviewer`, {
        reviewer: { kind: 'agent', agentId: reviewer },
        expected: await expectation(taskId),
      });
      record(
        `review routing: source-less ${trigger} refuses agent handoff`,
        transferred.status === 409 &&
          transferred.body.error === 'TASK_REVIEW_SOURCE_REQUIRED',
        `HTTP ${transferred.status}`,
      );
    }
    for (const policy of [
      'requireIndependentReviewer: true\n',
      'requiredCompetences: [review]\n',
    ]) {
      await setPolicy(policy);
      const governed = await submitted('Governed native source');
      const gate = (await state(governed.taskId)).pendingReview;
      record(
        `review routing: new native review follows human policy ${policy.trim()}`,
        gate?.reviewer?.kind === 'user' &&
          gate.runId === governed.runId &&
          (await loadTaskOrThrow(sql, governed.taskId, ctx.orgId)).status ===
            'in_review',
        'settlement completed with a human owner',
      );
    }
    await setPolicy('requireIndependentReviewer: [invalid]\n');
    const unreadable = await submitted('Unavailable policy during settlement');
    record(
      'review routing: unreadable policy retains configured agent without rolling back settlement',
      (await state(unreadable.taskId)).pendingReview
        ?.agentReviewBlockedReason === 'policy_unavailable' &&
        (await loadTaskOrThrow(sql, unreadable.taskId, ctx.orgId)).status ===
          'in_review',
      'pending owner retained; actionable policy repair',
    );
    const unavailableHandoff = await json(
      `tasks/${unreadable.taskId}/reviewer`,
      {
        reviewer: { kind: 'user', userId: ctx.userId },
        expected: await expectation(unreadable.taskId),
      },
    );
    const beforeUnavailableApproval = await loadTaskOrThrow(
      sql,
      unreadable.taskId,
      ctx.orgId,
    );
    const beforeUnavailableGate = (await state(unreadable.taskId))
      .pendingReview;
    const unavailableApproval = await json(
      `tasks/${unreadable.taskId}/status`,
      { status: 'done' },
    );
    const afterUnavailableApproval = await loadTaskOrThrow(
      sql,
      unreadable.taskId,
      ctx.orgId,
    );
    const afterUnavailableGate = (await state(unreadable.taskId)).pendingReview;
    record(
      'review routing: corrupt governance cannot authorize a human signoff after explicit captured agent-to-human CAS transfer',
      unavailableHandoff.status === 200 &&
        beforeUnavailableGate?.reviewer?.kind === 'user' &&
        unavailableApproval.status === 409 &&
        unavailableApproval.body.error === 'TASK_REVIEW_POLICY_UNAVAILABLE' &&
        JSON.stringify(afterUnavailableApproval) ===
          JSON.stringify(beforeUnavailableApproval) &&
        JSON.stringify(afterUnavailableGate) ===
          JSON.stringify(beforeUnavailableGate),
      `transfer=${unavailableHandoff.status} approval=${unavailableApproval.status} status=${afterUnavailableApproval.status}`,
    );
    await setPolicy(originalPolicy ?? '{}\n');
    const restoredHumanApproval = await json(
      `tasks/${unreadable.taskId}/status`,
      { status: 'done' },
    );
    record(
      'review routing: restoring valid governance permits the explicitly transferred human review to complete',
      restoredHumanApproval.status === 200 &&
        (await loadTaskOrThrow(sql, unreadable.taskId, ctx.orgId)).status ===
          'done' &&
        (await state(unreadable.taskId)).pendingReview === null,
      `HTTP ${restoredHumanApproval.status}`,
    );
    await configure(author, reviewer);
    const selfDefault = await submitted(
      'Default reviewer is implementation agent',
    );
    record(
      'review routing: self-review default settles with captured intent and visible block',
      (await state(selfDefault.taskId)).pendingReview?.reviewer?.kind ===
        'agent' &&
        (await state(selfDefault.taskId)).pendingReview
          ?.agentReviewBlockedReason === 'self_review',
      'no fallback agent or settlement rollback',
    );
    const selfChoice = await json(`tasks/${selfDefault.taskId}/reviewer`, {
      reviewer: { kind: 'inherit' },
      expected: await expectation(selfDefault.taskId),
    });
    record(
      'review routing: choosing the current self-review default is refused',
      selfChoice.status === 409 &&
        selfChoice.body.error === 'TASK_REVIEWER_NOT_INDEPENDENT',
      `HTTP ${selfChoice.status}`,
    );
    await configure(reviewer, author);
    await sql`UPDATE app.project_agents SET tools = ARRAY[]::text[] WHERE id = ${reviewer}`;
    const revoked = await submitted('Reviewer grant revoked before settlement');
    const revokedChoice = await json(`tasks/${human.taskId}/reviewer`, {
      reviewer: { kind: 'agent', agentId: reviewer },
      expected: await expectation(human.taskId),
    });
    const revokedDefault = await json(`projects/${project}/task-reviewer`, {
      reviewer: { kind: 'agent', agentId: reviewer },
      expected: { kind: 'agent', agentId: reviewer },
    });
    record(
      'review routing: grant revocation preserves settlement but refuses new or repeated selection',
      (await state(revoked.taskId)).pendingReview?.agentReviewBlockedReason ===
        'permission_missing' &&
        revokedChoice.status === 400 &&
        revokedDefault.status === 400,
      `task=${revokedChoice.status}, project=${revokedDefault.status}`,
    );
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review']::text[] WHERE id = ${reviewer}`;
    record(
      'review routing: restoring permission clears the derived block without changing ownership',
      (await state(revoked.taskId)).pendingReview?.agentReviewBlockedReason ===
        null,
      'same pending review',
    );
    await sql`UPDATE app.tasks SET assignee_id = ${reviewer} WHERE id = ${revoked.taskId}`;
    const changedSource = await state(revoked.taskId);
    const repair = await json(`tasks/${revoked.taskId}/reviewer`, {
      reviewer: { kind: 'user', userId: ctx.userId },
      expected: await expectation(revoked.taskId),
    });
    record(
      'review routing: changed implementation ownership explains its block and permits explicit human recovery',
      changedSource.pendingReview?.agentReviewBlockedReason ===
        'source_changed' &&
        repair.status === 200 &&
        (await state(revoked.taskId)).pendingReview?.reviewer?.kind === 'user',
      `HTTP ${repair.status}`,
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
    // Public PATCH does not carry reviewer fields; the legacy app POST does.
    // A member can still edit their own task, but cannot administer its reviewer.
    await configure(null, reviewer);
    const memberCard = await fx.insertTask({
      projectId: project,
      title: 'Member-owned ordinary edits',
    });
    const memberClearCard = await fx.insertTask({
      projectId: project,
      title: 'Member-owned review clear',
    });
    const memberEditCard = await fx.insertTask({
      projectId: project,
      title: 'Member-owned title edit',
    });
    await sql`UPDATE app.tasks SET reviewer_user_id = ${ctx.userId} WHERE id IN ${sql([memberCard, memberClearCard, memberEditCard])}`;
    const minted = await fetch(`${base}/api/auth/api-key/create`, {
      method: 'POST',
      headers: {
        cookie: ctx.cookie,
        origin: base,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: `routing-member-${fx.suffix}` }),
    });
    const key: unknown = await minted.json();
    if (!isRecord(key) || typeof key.key !== 'string')
      throw new Error('Could not create isolated reviewer boundary key');
    const roles = await sql<
      { role: string }[]
    >`SELECT role FROM "member" WHERE "organizationId" = ${ctx.orgId} AND "userId" = ${ctx.userId}`;
    await sql`UPDATE "member" SET role = 'member' WHERE "organizationId" = ${ctx.orgId} AND "userId" = ${ctx.userId}`;
    try {
      const changed = await json(`tasks/${memberCard}`, {
        reviewerUserId: starter,
      });
      const cleared = await json(`tasks/${memberClearCard}`, {
        reviewerUserId: null,
      });
      const ordinary = await json(`tasks/${memberEditCard}`, {
        reviewerUserId: ctx.userId,
        title: 'Member ordinary title saved',
      });
      const rest = await fetch(
        `${base}/api/v1/projects/${project}/tasks/${memberCard}`,
        {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${key.key}`,
            'x-organization-slug': orgs[0]?.slug ?? '',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ reviewerUserId: ctx.userId }),
        },
      );
      const retained = await loadTaskOrThrow(sql, memberCard, ctx.orgId);
      record(
        'review routing: real member app POST refuses reviewer changes and clear but keeps own ordinary edits',
        changed.status === 403 &&
          changed.body.error === 'RBAC_FORBIDDEN' &&
          cleared.status === 403 &&
          ordinary.status === 200 &&
          retained.reviewerUserId === ctx.userId &&
          (await loadTaskOrThrow(sql, memberClearCard, ctx.orgId))
            .reviewerUserId === ctx.userId &&
          (await loadTaskOrThrow(sql, memberEditCard, ctx.orgId)).title ===
            'Member ordinary title saved',
        `change=${changed.status}, clear=${cleared.status}, ordinary=${ordinary.status}`,
      );
      record(
        'review routing: public REST PATCH already refuses unsupported reviewer fields',
        rest.status === 400,
        `HTTP ${rest.status}; strict archive-only body`,
      );
    } finally {
      await sql`UPDATE "member" SET role = ${roles[0]?.role ?? 'owner'} WHERE "organizationId" = ${ctx.orgId} AND "userId" = ${ctx.userId}`;
    }
    await configure(reviewer, null);

    const store = pgTaskStore(sql);
    const batchScope = {
      organizationId: ctx.orgId,
      projectId: project,
      caller: {
        kind: 'system' as const,
        reason: 'isolated review lifecycle proof',
      },
    };
    await sql`UPDATE app.tasks SET external_system = 'crm', external_id = 'a-native' WHERE id = ${fresh.taskId}`;
    await sql`UPDATE app.tasks SET external_system = 'crm', external_id = 'b-human' WHERE id = ${human.taskId}`;
    const nativeBefore = await state(fresh.taskId);
    const issues = [
      {
        externalSystem: 'crm',
        externalId: 'a-native',
        title: 'External native update',
        externalState: 'closed' as const,
      },
      {
        externalSystem: 'crm',
        externalId: 'b-human',
        title: 'External human update',
        externalState: 'closed' as const,
      },
      {
        externalSystem: 'crm',
        externalId: 'c-new',
        title: 'Next item after native review',
        externalState: 'open' as const,
      },
    ];
    let batch: Awaited<ReturnType<typeof store.upsertIssues>> = [];
    const batchError = await refusal(async () => {
      batch = await store.upsertIssues({ ...batchScope, issues });
    });
    const nativeClosed = await loadTaskOrThrow(sql, fresh.taskId, ctx.orgId);
    const afterClose = await state(fresh.taskId);
    record(
      'review routing: defensive legacy store batch preserves native review and completes other items',
      batchError === null &&
        batch.length === 3 &&
        nativeClosed.status === 'in_review' &&
        nativeClosed.completedAt === null &&
        nativeClosed.externalClosedAt !== null &&
        afterClose.pendingReview?.approvalId ===
          nativeBefore.pendingReview?.approvalId &&
        (await loadTaskOrThrow(sql, human.taskId, ctx.orgId)).status ===
          'done' &&
        batch[2]?.created,
      `batch=${batch.length}, refusal=${batchError}, native=${nativeClosed.status}`,
    );
    const retryError = await refusal(() =>
      store.upsertIssues({ ...batchScope, issues }),
    );
    const retried = await loadTaskOrThrow(sql, fresh.taskId, ctx.orgId);
    record(
      'review routing: repeated upstream close is idempotent and records no native verdict',
      retryError === null &&
        retried.externalClosedAt === nativeClosed.externalClosedAt &&
        (await state(fresh.taskId)).pendingReview?.approvalId ===
          nativeBefore.pendingReview?.approvalId,
      `refusal=${retryError}`,
    );
    const firstIssue = issues[0];
    if (firstIssue === undefined)
      throw new Error('Missing custom source fixture');
    const reopening = { ...firstIssue, externalState: 'open' as const };
    const reopenError = await refusal(() =>
      store.upsertIssues({
        ...batchScope,
        issues: [reopening],
      }),
    );
    const reopened = await loadTaskOrThrow(sql, fresh.taskId, ctx.orgId);
    record(
      'review routing: custom upstream reopen clears its fact without withdrawing captured review',
      reopenError === null &&
        reopened.status === 'in_review' &&
        reopened.externalClosedAt === null &&
        (await state(fresh.taskId)).pendingReview?.approvalId ===
          nativeBefore.pendingReview?.approvalId,
      `refusal=${reopenError}, native=${reopened.status}`,
    );
    // Unlike the strict workflow-native upsert schema, the public custom
    // source intake still exposes externalState. Exercise that real door.
    for (const externalState of ['closed', 'open'] as const) {
      const response = await fetch(`${base}/api/v1/projects/${project}/tasks`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key.key}`,
          'x-organization-slug': orgs[0]?.slug ?? '',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          externalSystem: 'crm',
          externalId: 'a-native',
          title: 'External native update',
          externalState,
        }),
      });
      const current = await loadTaskOrThrow(sql, fresh.taskId, ctx.orgId);
      record(
        `review routing: authenticated REST custom source ${externalState} preserves the captured native gate`,
        response.status === 200 &&
          current.status === 'in_review' &&
          current.completedAt === null &&
          (externalState === 'closed'
            ? current.externalClosedAt !== null
            : current.externalClosedAt === null) &&
          (await state(fresh.taskId)).pendingReview?.approvalId ===
            nativeBefore.pendingReview?.approvalId,
        `HTTP ${response.status}, task=${current.status}`,
      );
    }

    const snapshot = await submitted('GitHub immutable-source native review');
    const sourceId = randomUUID();
    await sql`UPDATE app.tasks SET external_system = 'github', external_id = 'example/repo#1', external_source_id = ${sourceId} WHERE id = ${snapshot.taskId}`;
    const snapshotBefore = await state(snapshot.taskId);
    await store.upsertIssues({
      ...batchScope,
      issues: [
        {
          externalSystem: 'github',
          externalId: 'example/repo#1',
          title: 'Upstream changed title',
          externalIssue: {
            id: sourceId,
            title: 'Upstream changed title',
            description: 'Upstream body',
            url: 'https://github.com/example/repo/issues/1',
            state: 'closed',
            syncedAt: Date.now(),
            repositoryId: 123,
            number: 1,
          },
        },
      ],
    });
    const refreshed = await loadTaskOrThrow(sql, snapshot.taskId, ctx.orgId);
    record(
      'review routing: immutable GitHub source already refreshes closure without native review transition',
      refreshed.status === 'in_review' &&
        refreshed.externalIssue?.state === 'closed' &&
        refreshed.title === 'GitHub immutable-source native review' &&
        (await state(snapshot.taskId)).pendingReview?.approvalId ===
          snapshotBefore.pendingReview?.approvalId,
      'control: source refresh lane never uses legacy Done',
    );
    const repeating = await fx.insertTask({
      projectId: project,
      title: 'Retain deleted reviewer in repeat',
      status: 'in_progress',
      agentId: author,
    });
    await sql`UPDATE app.tasks SET reviewer_agent_id = ${reviewer}, repeat_rule = ${sql.json({ frequency: 'daily', interval: 1, timezone: 'UTC' })} WHERE id = ${repeating}`;
    await transactSerializable(sql, (tx) =>
      deleteProjectAgent(tx, auth, reviewer),
    );
    const deleted = await state(fresh.taskId);
    record(
      'review routing: deleting reviewer preserves agent-owned wait without creator fallback',
      deleted.projectReviewer.kind === 'agent' &&
        deleted.pendingReview?.reviewer?.kind === 'agent' &&
        deleted.pendingReview.requestedFor === null &&
        deleted.pendingReview.agentReviewBlockedReason ===
          'reviewer_unavailable',
      'routing and captured history survive missing agent',
    );
    const copy = await transactSerializable(sql, async (tx) =>
      createNextRepeatCopy(tx, {
        task: await loadTaskOrThrow(tx, repeating, ctx.orgId),
        toStatus: 'done',
        actorType: 'user',
        actorId: ctx.userId,
        audit: auth,
      }),
    );
    const repeated =
      copy === null ? null : await loadTaskOrThrow(sql, copy.id, ctx.orgId);
    record(
      'review routing: repeat preserves deleted explicit agent for repair instead of inheriting another reviewer',
      repeated?.reviewerAgentId === reviewer &&
        repeated.reviewerUserId === null &&
        repeated.status === 'todo',
      copy === null ? 'missing repeat copy' : `copy ${copy.id}`,
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
    await setPolicy(originalPolicy ?? '{}\n');
    await sql`DELETE FROM app.approvals WHERE org_id = ${ctx.orgId} AND metadata ->> 'projectId' IN ${sql([project, neighbor])}`;
    await sql`DELETE FROM app.projects WHERE id IN ${sql([project, neighbor])} AND org_id = ${ctx.orgId}`;
    await fx.teardownUsers();
  }
}
