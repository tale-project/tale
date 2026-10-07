/** Native HTTP/token, PostgreSQL and contention proof of independent agent
 * review. All source runs are inert fixtures, all queued agent work is held,
 * and the harness denies external provider traffic. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { TaskAgentReviewInput } from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import { memberSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { AGENT_TOOL_CATALOG } from '../../core/sandbox/tool_names.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { insertSessionToken } from '../sandbox/sessions.ts';
import { checkAgentReviewFiles } from './agent-review-files.integration.ts';
import { reviewAgentTask } from './agent-review.ts';
import { addTaskComment } from './comments.ts';
import {
  fixtures,
  holdAgentJobs,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import { getProjectTaskMetrics } from './metrics.ts';
import { checkReviewDelegation } from './review-delegation.integration.ts';
import { checkReviewRepair } from './review-repair.integration.ts';
import { getPendingReviewForTask, requestTaskReview } from './reviews.ts';
import {
  agentUpdateTaskStatusTrusted,
  loadTaskOrThrow,
  setTaskReviewer,
  updateTaskStatus,
} from './service.ts';

type Body = Record<string, unknown>;
const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const output = (body: Body): Body => (isRecord(body.output) ? body.output : {});
const refused = (body: Body, code: string) =>
  body.status === 'invalid_args' && String(body.message).startsWith(`${code}:`);

function latch() {
  let resolve: (() => void) | undefined;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, release: () => resolve?.() };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Agent review race barrier timed out')),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
/** Observe a real PostgreSQL answer; do not replace queries or their results. */
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

export async function checkAgentTaskReviews(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  orgSlug: string,
  record: Recorder,
): Promise<void> {
  const { orgId } = ctx;
  const fx = fixtures(sql, ctx);
  const project = randomUUID();
  const neighbor = randomUUID();
  const foreignOrg = randomUUID();
  const foreignProject = randomUUID();
  const author = randomUUID();
  const reviewer = randomUUID();
  const editor = `review-editor-${fx.suffix}`;
  const sessions = new Set<string>();
  const tokenHashes: string[] = [];
  const release = await holdAgentJobs(sql, fx.suffix, [project, neighbor]);
  const auth = await getProjectAuthContext(sql, {
    organizationId: orgId,
    userId: ctx.userId,
    role: 'owner',
  });
  const policyDir = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    orgSlug,
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
  const state = (id: string) => loadTaskOrThrow(sql, id, orgId);
  const dispatch = async (
    token: string,
    args: unknown,
    tool = 'task_review',
  ): Promise<Body> => {
    const response = await fetch(`${base}/api/tools/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, args }),
    });
    const value: unknown = await response.json();
    if (!isRecord(value)) throw new Error('Native review returned no object');
    return value;
  };
  const tokenFor = async (
    sessionId: string,
    execId?: string,
    grants = ['task_get', 'task_review'],
  ) => {
    const token = `itest-review-${randomUUID()}`;
    const hash = createHash('sha256').update(token).digest('hex');
    tokenHashes.push(hash);
    await insertSessionToken(sql, {
      organizationId: orgId,
      sessionId,
      tokenHash: hash,
      scope: {
        agentKind: 'claude-code',
        allowedModels: [],
        connectorGrants: [],
        budgetCents: 100,
        toolGrants: grants,
        ...(execId === undefined ? {} : { taskRun: { execId } }),
      },
      ttlMs: 600_000,
    });
    return token;
  };
  const addRun = async (
    taskId: string,
    agentId: string,
    status = 'settled',
    sessionId = `pa-${agentId}`,
  ) => {
    const id = randomUUID();
    const execId = `review-${randomUUID()}`;
    await sql`INSERT INTO app.project_agent_runs (id, org_id, project_id, task_id, agent_id, exec_id, session_id, status, harness, model, started_by, started_at_ms, launched_at_ms, deadline_at_ms, settled_at_ms, updated_at_ms, result_text)
      VALUES (${id}, ${orgId}, ${project}, ${taskId}, ${agentId}, ${execId}, ${sessionId}, ${status}, 'claude-code', 'itest-model', ${editor}, ${fx.now}, ${fx.now}, ${fx.now + 3_600_000}, ${status === 'settled' ? fx.now : null}, ${fx.now}, 'Captured implementation result')`;
    return { id, execId, sessionId };
  };
  const submitted = async (title: string, agentId = author) => {
    const taskId = await fx.insertTask({
      projectId: project,
      title,
      status: 'in_review',
      agentId,
    });
    const source = await addRun(taskId, agentId);
    await sql`UPDATE app.tasks SET reviewer_agent_id = ${reviewer} WHERE id = ${taskId}`;
    await transactSerializable(sql, async (tx) =>
      requestTaskReview(tx, {
        task: await loadTaskOrThrow(tx, taskId, orgId),
        trigger: { kind: 'agent_run', runId: source.id },
      }),
    );
    return { taskId, runId: source.id };
  };
  const inputFor = async (taskId: string): Promise<TaskAgentReviewInput> => {
    const pending = await getPendingReviewForTask(sql, orgId, taskId);
    if (!pending?.runId || !pending.evidenceRevision)
      throw new Error('Fixture review has no settled source evidence');
    return {
      taskId,
      expected: {
        approvalId: pending.approvalId,
        runId: pending.runId,
        evidenceRevision: pending.evidenceRevision,
      },
      decision: 'approve',
      feedback:
        'Reviewed captured implementation and local regression: passed.',
      evidence: {
        checks: [
          {
            name: 'Local regression',
            outcome: 'passed',
            details: 'The captured source passed the fixture control.',
          },
        ],
        pullRequests: [],
      },
    };
  };
  const counts = async (taskId: string) => {
    const rows = await sql<
      {
        runs: number;
        comments: number;
        decisions: number;
        automationRuns: number;
        jobs: number;
      }[]
    >`
      SELECT (SELECT count(*)::int FROM app.project_agent_runs WHERE task_id = ${taskId}) AS runs,
        (SELECT count(*)::int FROM app.task_discussion_message_meta WHERE task_id = ${taskId}) AS comments,
        (SELECT count(*)::int FROM app.task_activity WHERE task_id = ${taskId} AND action = 'review.responded') AS decisions,
        (SELECT count(*)::int FROM app.automation_runs WHERE org_id = ${orgId} AND input -> 'task' ->> 'id' = ${taskId}) AS "automationRuns",
        (SELECT count(*)::int FROM pgboss.job WHERE name IN ('task.agent_turn', 'task.agent_retry') AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs WHERE task_id = ${taskId})) AS jobs
    `;
    return rows[0];
  };
  const governanceEffects = async (taskId: string) => {
    const rows = await sql<
      { audit: number; notifications: number; realtime: number }[]
    >`
      SELECT (SELECT count(*)::int FROM app.audit_logs WHERE org_id = ${orgId} AND resource_id = ${taskId}) AS audit,
        (SELECT count(*)::int FROM app.user_notifications WHERE org_id = ${orgId} AND task_id = ${taskId}) AS notifications,
        (SELECT count(*)::int FROM app_realtime.outbox WHERE org_id = ${orgId} AND entity = 'task' AND entity_id = ${taskId}) AS realtime
    `;
    return { ...rows[0], ...(await counts(taskId)) };
  };
  try {
    await fx.insertUser(editor, 'editor');
    await fx.insertProject(project, 'Native agent review');
    await fx.insertProject(neighbor, 'Neighbor review');
    const foreign = fixtures(sql, { ...ctx, orgId: foreignOrg });
    await foreign.insertProject(foreignProject, 'Other tenant');
    await fx.insertAgent(author, project, 'Implementation');
    await fx.insertAgent(reviewer, project, 'Independent review');
    await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get', 'task_review'])} WHERE id = ${reviewer}`;
    await setPolicy('{}\n');
    const roleTask = await fx.insertTask({
      projectId: project,
      title: 'Reviewer role',
      agentId: reviewer,
      status: 'in_progress',
    });
    const issuer = await addRun(roleTask, reviewer, 'running');
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${issuer.sessionId}, 'active', 'project_agent', ${reviewer}, 'itest:review', ${fx.now}, ${fx.now + 3_600_000})`;
    sessions.add(issuer.sessionId);
    const token = await tokenFor(issuer.sessionId, issuer.execId);
    const authority = {
      organizationId: orgId,
      projectId: project,
      agentId: reviewer,
      sessionId: issuer.sessionId,
      execId: issuer.execId,
    };
    const target = await submitted('Successful native review');
    const input = await inputFor(target.taskId);
    const read = await dispatch(token, { taskId: target.taskId }, 'task_get');
    const pending = output(read).pendingReview;
    record(
      'agent review: native task_get supplies exact source actor and evidence revision',
      read.status === 'ok' &&
        isRecord(pending) &&
        pending.implementationAgentId === author &&
        pending.evidenceRevision === input.expected.evidenceRevision,
      `status=${String(read.status)}`,
    );
    await sql`UPDATE app.projects SET open_task_count = 2, done_task_count = 0 WHERE id = ${project}`;
    const result = await dispatch(token, input);
    const stored = await state(target.taskId);
    const rows = await sql<
      { status: string; approvedBy: string | null; metadata: Body }[]
    >`SELECT status, approved_by AS "approvedBy", metadata FROM app.approvals WHERE id = ${input.expected.approvalId}`;
    const receipt = output(result);
    record(
      'agent review: independent HTTP verdict atomically completes with typed agent receipt and preserved implementer',
      result.status === 'ok' &&
        stored.status === 'done' &&
        stored.completedAt !== null &&
        stored.assigneeId === author &&
        rows[0]?.status === 'completed' &&
        rows[0].approvedBy === null &&
        isDeepStrictEqual(rows[0].metadata.response, receipt) &&
        receipt.issuerRunId === issuer.id,
      `status=${String(result.status)} task=${stored.status}`,
    );
    const rollup = await sql<
      { open: number; done: number }[]
    >`SELECT open_task_count AS open, done_task_count AS done FROM app.projects WHERE id = ${project}`;
    const trail = await sql<
      { actorType: string; actorId: string; action: string }[]
    >`SELECT actor_type AS "actorType", actor_id AS "actorId", action FROM app.task_activity WHERE task_id = ${target.taskId}`;
    const hints = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM app_realtime.outbox WHERE org_id = ${orgId} AND entity = 'task' AND entity_id = ${target.taskId}`;
    record(
      'agent review: ordinary completion rollup, agent activity and realtime notification seam are preserved',
      rollup[0]?.open === 1 &&
        rollup[0].done === 1 &&
        (hints[0]?.count ?? 0) > 0 &&
        trail.some(
          (row) =>
            row.action === 'status.changed' &&
            row.actorId === reviewer &&
            row.actorType === 'agent',
        ) &&
        trail.some(
          (row) =>
            row.action === 'review.responded' && row.actorId === reviewer,
        ),
      `open=${rollup[0]?.open} done=${rollup[0]?.done}`,
    );
    const beforeReplay = await counts(target.taskId);
    const replay = await dispatch(token, input);
    record(
      'agent review: exact live-issuer replay repeats no comment, decision or run',
      JSON.stringify(output(replay)) === JSON.stringify(receipt) &&
        JSON.stringify(await counts(target.taskId)) ===
          JSON.stringify(beforeReplay),
      `status=${String(replay.status)}`,
    );
    const changedReplay = await dispatch(token, {
      ...input,
      feedback: 'Changed feedback.',
    });
    record(
      'agent review: changed replay is stale without effects',
      refused(changedReplay, 'TASK_REVIEW_STALE') &&
        JSON.stringify(await counts(target.taskId)) ===
          JSON.stringify(beforeReplay),
      String(changedReplay.message),
    );
    await sql`UPDATE app.project_agents SET tools = ARRAY[]::text[] WHERE id = ${reviewer}`;
    const revokedReplay = await dispatch(token, input);
    record(
      'agent review: revoked current grant refuses even a valid receipt replay',
      refused(revokedReplay, 'TASK_REVIEW_FORBIDDEN') &&
        JSON.stringify(await counts(target.taskId)) ===
          JSON.stringify(beforeReplay),
      String(revokedReplay.message),
    );
    await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get', 'task_review'])} WHERE id = ${reviewer}`;

    const changes = await submitted('Changes requested');
    const changesInput = {
      ...(await inputFor(changes.taskId)),
      decision: 'request_changes' as const,
      feedback: `@${author} @${reviewer} Reproduce and fix the failing focus check.`,
      evidence: {
        checks: [
          {
            name: 'Focus',
            outcome: 'failed' as const,
            details: 'Confirmation cannot be reached by Tab.',
          },
        ],
        pullRequests: [],
      },
    };
    const changesBefore = await counts(changes.taskId);
    const rejected = await dispatch(token, changesInput);
    const changesAfter = await counts(changes.taskId);
    const comments = await sql<
      {
        authorType: string;
        authorId: string;
        mentions: Array<{ type: string; id: string }> | null;
      }[]
    >`SELECT author_type AS "authorType", author_id AS "authorId", mentions FROM app.task_discussion_message_meta WHERE task_id = ${changes.taskId}`;
    record(
      'agent review: request_changes writes visible agent feedback but admits no agent or automation, including mentions',
      rejected.status === 'ok' &&
        (await state(changes.taskId)).status === 'todo' &&
        (await state(changes.taskId)).assigneeId === author &&
        changesAfter?.comments === 1 &&
        changesAfter.runs === changesBefore?.runs &&
        changesAfter.jobs === changesBefore?.jobs &&
        changesAfter.automationRuns === changesBefore?.automationRuns &&
        comments[0]?.authorType === 'agent' &&
        comments[0].authorId === reviewer &&
        comments[0].mentions?.some(
          (mention) => mention.type === 'agent' && mention.id === author,
        ) === true,
      `status=${String(rejected.status)} runs=${changesAfter?.runs} comments=${changesAfter?.comments}`,
    );

    const changesReplay = await dispatch(token, changesInput);
    const withdrawn = await submitted('Review withdrawn without a verdict');
    const withdrawal = await transactSerializable(sql, (tx) =>
      agentUpdateTaskStatusTrusted(tx, {
        organizationId: orgId,
        actorId: author,
        taskId: withdrawn.taskId,
        status: 'todo',
      }),
    );
    const metrics = await getProjectTaskMetrics(sql, auth, project, {
      periodDays: 7,
    });
    const requestedChanges = metrics.daily.reduce(
      (total, day) => total + day.reviewsChangesRequested,
      0,
    );
    const approved = metrics.daily.reduce(
      (total, day) => total + day.reviewsPassed,
      0,
    );
    record(
      'agent review: metrics count the native requested-changes receipt once and exclude an ordinary agent withdrawal',
      changesReplay.status === 'ok' &&
        withdrawal.ok &&
        (await state(withdrawn.taskId)).status === 'todo' &&
        requestedChanges === 1 &&
        approved === 1,
      `requestedChanges=${requestedChanges} approved=${approved} withdrawal=${withdrawal.ok}`,
    );

    const repeating = await submitted('Repeating accepted review');
    await sql`UPDATE app.tasks SET repeat_rule = ${sql.json({ frequency: 'daily', interval: 1, timezone: 'UTC' })}, due_date_ms = ${fx.now} WHERE id = ${repeating.taskId}`;
    const repeatInput = await inputFor(repeating.taskId);
    const repeatVerdict = await dispatch(token, repeatInput);
    const completedRepeat = await state(repeating.taskId);
    const next =
      completedRepeat.repeatNextTaskId === null
        ? null
        : await state(completedRepeat.repeatNextTaskId);
    const repeatReplay = await dispatch(token, repeatInput);
    record(
      'agent review: acceptance continues a repeating task once through the shared completion seam',
      repeatVerdict.status === 'ok' &&
        next?.status === 'todo' &&
        next.assigneeId === author &&
        next.reviewerAgentId === reviewer &&
        repeatReplay.status === 'ok' &&
        (await state(repeating.taskId)).repeatNextTaskId === next.id,
      `verdict=${String(repeatVerdict.status)} next=${next?.status ?? 'none'}`,
    );

    const untouched = await submitted('Refused authority');
    const untouchedInput = await inputFor(untouched.taskId);
    const allOtherGrants = AGENT_TOOL_CATALOG.map((tool) => tool.name).filter(
      (name) => name !== 'task_review',
    );
    const noGrant = await dispatch(
      await tokenFor(issuer.sessionId, issuer.execId, allOtherGrants),
      untouchedInput,
    );
    const noExec = await dispatch(
      await tokenFor(issuer.sessionId),
      untouchedInput,
    );
    record(
      'agent review: all other tool grants and a legacy exec-less token cannot decide',
      noGrant.status === 'unavailable' &&
        JSON.stringify(noGrant).includes('not_granted') &&
        noExec.status === 'unavailable' &&
        (await state(untouched.taskId)).status === 'in_review',
      `ungranted=${String(noGrant.status)} noExec=${String(noExec.status)}`,
    );
    await fx.setRole(editor, 'member');
    const lostRole = await dispatch(token, untouchedInput);
    await fx.setRole(editor, 'editor');
    record(
      'agent review: a starter losing project authority cannot decide with an old token',
      lostRole.status === 'unavailable' &&
        (await state(untouched.taskId)).status === 'in_review',
      `status=${String(lostRole.status)}`,
    );
    const confinedSession = memberSessionIdForProjectAgent(reviewer, editor);
    await sql`UPDATE app.project_agent_runs SET session_id = ${confinedSession} WHERE id = ${issuer.id}`;
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${confinedSession}, 'active', 'project_agent', ${reviewer}, 'itest:review', ${fx.now}, ${fx.now + 3_600_000})`;
    sessions.add(confinedSession);
    const confined = await dispatch(
      await tokenFor(confinedSession, issuer.execId),
      untouchedInput,
    );
    await sql`UPDATE app.project_agent_runs SET session_id = ${issuer.sessionId} WHERE id = ${issuer.id}`;
    record(
      'agent review: member workspace remains confined after promotion',
      confined.status === 'unavailable' &&
        (await state(untouched.taskId)).status === 'in_review',
      `status=${String(confined.status)}`,
    );
    for (const [description, taskId] of [
      [
        'neighbor',
        await fx.insertTask({ projectId: neighbor, title: 'Other project' }),
      ],
      [
        'tenant',
        await foreign.insertTask({
          projectId: foreignProject,
          title: 'Other tenant',
        }),
      ],
      ['missing', randomUUID()],
    ]) {
      const other = await dispatch(token, { ...untouchedInput, taskId });
      record(
        `agent review: ${description} target is unavailable without a decision`,
        other.status === 'not_found' &&
          (await state(untouched.taskId)).status === 'in_review',
        `status=${String(other.status)}`,
      );
    }
    const forged = await dispatch(token, {
      ...untouchedInput,
      agentId: author,
    });
    record(
      'agent review: input cannot forge the reviewer identity',
      forged.status === 'invalid_args' &&
        (await state(untouched.taskId)).status === 'in_review',
      String(forged.message),
    );
    const self = await submitted('Self authored', reviewer);
    const selfResult = await dispatch(token, await inputFor(self.taskId));
    record(
      'agent review: actual source agent cannot approve its own work',
      refused(selfResult, 'TASK_REVIEWER_NOT_INDEPENDENT') &&
        (await state(self.taskId)).status === 'in_review',
      String(selfResult.message),
    );

    for (const kind of [
      'description',
      'result',
      'comment',
      'assignee',
      'newer_source',
      'workflow',
    ] as const) {
      const stale = await submitted(`Stale ${kind}`);
      const before = await inputFor(stale.taskId);
      if (kind === 'description')
        await sql`UPDATE app.tasks SET description = 'Changed requirement' WHERE id = ${stale.taskId}`;
      if (kind === 'result')
        await sql`UPDATE app.project_agent_runs SET result_text = 'Changed result' WHERE id = ${stale.runId}`;
      if (kind === 'comment')
        await transactSerializable(sql, (tx) =>
          addTaskComment(tx, auth, {
            taskId: stale.taskId,
            body: 'New acceptance requirement.',
          }),
        );
      if (kind === 'assignee')
        await sql`UPDATE app.tasks SET assignee_id = ${reviewer} WHERE id = ${stale.taskId}`;
      if (kind === 'newer_source') await addRun(stale.taskId, author, 'failed');
      if (kind === 'workflow')
        await sql`UPDATE app.approvals SET wf_execution_id = 'protected-workflow' WHERE id = ${before.expected.approvalId}`;
      const staleResult = await dispatch(token, before);
      record(
        `agent review: ${kind} changes refuse a delayed verdict`,
        refused(
          staleResult,
          kind === 'workflow'
            ? 'TASK_REVIEW_SOURCE_REQUIRED'
            : 'TASK_REVIEW_STALE',
        ) && (await state(stale.taskId)).status === 'in_review',
        String(staleResult.message),
      );
    }
    const protectedTask = await submitted('Protected automation ask');
    const protectedInput = await inputFor(protectedTask.taskId);
    await sql`INSERT INTO app.automation_runs (org_id, project_id, name, version, status, mode, started_by, input, detail, started_at_ms)
      VALUES (${orgId}, ${project}, ${`itest/review-${fx.suffix}`}, 1, 'waiting', 'live', ${editor}, ${sql.json({ task: { id: protectedTask.taskId } })}, 'agent:triage', ${fx.now})`;
    const protectedResult = await dispatch(token, protectedInput);
    record(
      'agent review: a live automation question remains protected',
      refused(protectedResult, 'TASK_REVIEW_BUSY') &&
        (await state(protectedTask.taskId)).status === 'in_review',
      String(protectedResult.message),
    );
    const childTask = await submitted('Open subtask');
    const child = await fx.insertTask({
      projectId: project,
      title: 'Unfinished child',
    });
    await sql`UPDATE app.tasks SET parent_task_id = ${childTask.taskId} WHERE id = ${child}`;
    const childResult = await dispatch(token, await inputFor(childTask.taskId));
    record(
      'agent review: open subtasks still prevent completion',
      refused(childResult, 'TASK_HAS_OPEN_SUBTASKS'),
      String(childResult.message),
    );
    const blocked = await submitted('Open predecessor');
    const blocker = await fx.insertTask({
      projectId: project,
      title: 'Blocker',
    });
    await fx.block(blocked.taskId, blocker, project);
    const blockedResult = await dispatch(token, await inputFor(blocked.taskId));
    record(
      'agent review: open dependencies still prevent completion',
      refused(blockedResult, 'TASK_REVIEW_BLOCKED'),
      String(blockedResult.message),
    );
    for (const starterMatches of [true, false]) {
      for (const decision of ['approve', 'request_changes'] as const) {
        const independent = await submitted(
          `Independent person policy: ${starterMatches ? 'same' : 'different'} starter ${decision}`,
        );
        if (!starterMatches)
          await sql`UPDATE app.project_agent_runs SET started_by = ${ctx.userId} WHERE id = ${independent.runId}`;
        const independentInput = {
          ...(await inputFor(independent.taskId)),
          decision,
        };
        const before = await governanceEffects(independent.taskId);
        await setPolicy('requireIndependentReviewer: true\n');
        const response = await dispatch(token, independentInput);
        const current = await getPendingReviewForTask(
          sql,
          orgId,
          independent.taskId,
        );
        record(
          `agent review: independent-human policy refuses ${decision} with ${starterMatches ? 'the same' : 'a different'} starter without effects`,
          refused(response, 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED') &&
            (await state(independent.taskId)).status === 'in_review' &&
            current?.approvalId === independentInput.expected.approvalId &&
            current.reviewer?.kind === 'agent' &&
            current.reviewer.agentId === reviewer &&
            isDeepStrictEqual(
              await governanceEffects(independent.taskId),
              before,
            ),
          String(response.message),
        );
        await setPolicy('{}\n');
      }
    }
    const humanRecovery = await submitted('Independent person handoff');
    const recoveryInput = await inputFor(humanRecovery.taskId);
    const recoveryPending = await getPendingReviewForTask(
      sql,
      orgId,
      humanRecovery.taskId,
    );
    if (recoveryPending === null)
      throw new Error('Governance recovery lost its captured review');
    await setPolicy('requireIndependentReviewer: true\n');
    await transactSerializable(sql, (tx) =>
      setTaskReviewer(tx, auth, humanRecovery.taskId, {
        reviewer: { kind: 'user', userId: ctx.userId },
        expected: {
          reviewer: { kind: 'agent', agentId: reviewer },
          pendingReview: {
            approvalId: recoveryPending.approvalId,
            runId: recoveryPending.runId,
            reviewer: recoveryPending.reviewer,
          },
        },
      }),
    );
    const starterAuth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: editor,
      role: 'editor',
    });
    const starterDone = await refusal(() =>
      transactSerializable(sql, (tx) =>
        updateTaskStatus(tx, starterAuth, humanRecovery.taskId, 'done'),
      ),
    );
    const staleAgent = await dispatch(token, recoveryInput);
    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, auth, humanRecovery.taskId, 'done'),
    );
    record(
      'agent review: explicit human handoff preserves the independent-person gate and refuses the stale agent',
      starterDone === 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED' &&
        refused(staleAgent, 'TASK_REVIEW_STALE') &&
        (await state(humanRecovery.taskId)).status === 'done',
      `starter=${starterDone}; staleAgent=${String(staleAgent.message)}`,
    );
    await setPolicy('{}\n');
    const governed = await submitted('Governed sign-off');
    const governedInput = await inputFor(governed.taskId);
    await setPolicy('requiredCompetences: [release]\n');
    const governedResult = await dispatch(token, governedInput);
    record(
      'agent review: human competence policy refuses instead of borrowing starter credentials',
      refused(governedResult, 'TASK_REVIEW_HUMAN_COMPETENCE_REQUIRED') &&
        (await state(governed.taskId)).status === 'in_review',
      String(governedResult.message),
    );
    await setPolicy('requiredCompetences: [\n');
    for (const decision of ['approve', 'request_changes'] as const) {
      const before = await governanceEffects(governed.taskId);
      const malformedPolicy = await dispatch(token, {
        ...governedInput,
        decision,
      });
      record(
        `agent review: unreadable policy refuses ${decision} without effects`,
        refused(malformedPolicy, 'TASK_REVIEW_POLICY_UNAVAILABLE') &&
          isDeepStrictEqual(await governanceEffects(governed.taskId), before),
        String(malformedPolicy.message),
      );
    }
    await setPolicy('{}\n');
    const rolledBack = await submitted('Rollback after verdict');
    const rollbackInput = await inputFor(rolledBack.taskId);
    const rollbackBefore = await counts(rolledBack.taskId);
    const rollback = await refusal(() =>
      transactSerializable(sql, async (tx) => {
        await reviewAgentTask(tx, authority, rollbackInput);
        throw new Error('itest: rollback after complete verdict');
      }),
    );
    record(
      'agent review: transaction rollback preserves pending gate, status, feedback and audit together',
      rollback !== null &&
        (await state(rolledBack.taskId)).status === 'in_review' &&
        (await getPendingReviewForTask(sql, orgId, rolledBack.taskId))
          ?.approvalId === rollbackInput.expected.approvalId &&
        JSON.stringify(await counts(rolledBack.taskId)) ===
          JSON.stringify(rollbackBefore),
      'forced post-decision rollback',
    );
    for (const verdictFirst of [true, false]) {
      const racing = await submitted(
        `Race ${verdictFirst ? 'verdict' : 'handoff'} first`,
      );
      const raceInput = await inputFor(racing.taskId);
      const racePending = await getPendingReviewForTask(
        sql,
        orgId,
        racing.taskId,
      );
      if (racePending === null) throw new Error('Race lost its approval');
      const handoff = (tx: TransactionSql) =>
        setTaskReviewer(tx, auth, racing.taskId, {
          reviewer: { kind: 'user', userId: ctx.userId },
          expected: {
            reviewer: { kind: 'agent', agentId: reviewer },
            pendingReview: {
              approvalId: racePending.approvalId,
              runId: racePending.runId,
              reviewer: racePending.reviewer,
            },
          },
        });
      const verdict = (tx: TransactionSql) =>
        reviewAgentTask(tx, authority, raceInput);
      const ready = latch();
      const releaseFirst = latch();
      const seen = latch();
      const first = transactSerializable(sql, async (tx) => {
        await (verdictFirst ? verdict(tx) : handoff(tx));
        ready.release();
        await bounded(releaseFirst.ready);
      });
      let second: Promise<string | null> | undefined;
      try {
        await bounded(ready.ready);
        second = refusal(() =>
          transactSerializable(sql, async (tx) => {
            await (verdictFirst
              ? handoff(observeTaskRead(tx, seen.release))
              : verdict(observeTaskRead(tx, seen.release)));
          }),
        );
        await bounded(seen.ready);
      } finally {
        releaseFirst.release();
      }
      const results = await bounded(Promise.all([first, second]));
      const final = await state(racing.taskId);
      record(
        `agent review: serializable ${verdictFirst ? 'verdict before handoff' : 'handoff before verdict'} admits one owner`,
        results[1] ===
          (verdictFirst ? 'TASK_REVIEWER_STALE' : 'TASK_REVIEW_STALE') &&
          final.status === (verdictFirst ? 'done' : 'in_review'),
        `loser=${results[1]} status=${final.status}`,
      );
    }
    await checkReviewDelegation({
      sql,
      orgId,
      projectId: project,
      neighborProjectId: neighbor,
      implementerId: author,
      reviewerId: reviewer,
      reviewerToken: token,
      reviewerAuthority: authority,
      auth,
      fx,
      sessions,
      record,
      submit: submitted,
      inputFor,
      dispatch,
      tokenFor,
      addRun,
      setPolicy,
    });
    await checkReviewRepair({
      sql,
      orgId,
      projectId: project,
      implementerId: author,
      editorId: editor,
      auth,
      fx,
      sessions,
      reviewerToken: token,
      record,
      submit: submitted,
      inputFor,
      dispatch,
      tokenFor,
      addRun,
    });
    await checkAgentReviewFiles({
      sql,
      base,
      orgId,
      orgSlug,
      reviewerId: reviewer,
      sessionId: issuer.sessionId,
      token,
      record,
      submit: submitted,
      inputFor,
      dispatch,
      snapshot: async (taskId) => ({
        task: await state(taskId),
        effects: await governanceEffects(taskId),
        pending: await getPendingReviewForTask(sql, orgId, taskId),
      }),
      transferToHuman: async (taskId) => {
        const captured = await getPendingReviewForTask(sql, orgId, taskId);
        if (captured === null) throw new Error('File fixture lost its review');
        return transactSerializable(sql, (tx) =>
          setTaskReviewer(tx, auth, taskId, {
            reviewer: { kind: 'user', userId: ctx.userId },
            expected: {
              reviewer: { kind: 'agent', agentId: reviewer },
              pendingReview: {
                approvalId: captured.approvalId,
                runId: captured.runId,
                reviewer: captured.reviewer,
              },
            },
          }),
        );
      },
    });
    await sql`UPDATE app.project_agent_runs SET status = 'cancelled', settled_at_ms = ${Date.now()} WHERE id = ${issuer.id}`;
    const ended = await dispatch(token, untouchedInput);
    record(
      'agent review: ended issuer cannot decide with its retained token',
      ended.status === 'unavailable' &&
        (await state(untouched.taskId)).status === 'in_review',
      `status=${String(ended.status)}`,
    );
  } finally {
    // This lane owns the fresh fixture rows. Preserve an absent policy as an
    // empty policy; no user configuration or durable audit history is erased.
    await setPolicy(originalPolicy ?? '{}\n');
    await sql`DELETE FROM app.sandbox_session_tokens WHERE token_hash IN ${sql(tokenHashes)}`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId} AND session_id IN ${sql([...sessions])}`;
    await sql`DELETE FROM app.approvals WHERE org_id = ${orgId} AND metadata ->> 'projectId' IN ${sql([project, neighbor])}`;
    await sql`DELETE FROM app.automation_runs WHERE org_id = ${orgId} AND name = ${`itest/review-${fx.suffix}`}`;
    await sql`DELETE FROM app.projects WHERE id IN ${sql([project, neighbor, foreignProject])}`;
    await fx.teardownUsers();
    await release();
  }
}
