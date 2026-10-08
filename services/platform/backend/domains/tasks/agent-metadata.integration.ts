import { createHash, randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { memberSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { AGENT_TOOL_CATALOG } from '../../core/sandbox/tool_names.ts';
/** Real HTTP/session grants, PostgreSQL rollback and contention for the
 * optional metadata tool. Queued agent work is held by the existing test
 * fixture: no sandbox or provider runs, including in the real-start races. */
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { insertSessionToken } from '../sandbox/sessions.ts';
import { updateAgentTaskMetadata } from './agent-metadata.ts';
import {
  fixtures,
  holdAgentJobs,
  type LaneCtx,
  type Recorder,
  runsOf,
} from './delegated-start.integration.ts';
import { startDelegatedAgentRun } from './delegated-start.ts';
import { loadTaskOrThrow } from './service.ts';

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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('metadata integration barrier timed out')),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Observe a real task read after PostgreSQL answers it. All methods and
 * non-query SQL helpers are forwarded unchanged; this is a race barrier,
 * not a replacement database or a claim based on scheduling luck. */
function observeTaskRead(tx: TransactionSql, read: () => void): TransactionSql {
  return new Proxy(tx, {
    apply(target, thisArg, args: unknown[]) {
      const result: unknown = Reflect.apply(target, thisArg, args);
      const strings = args[0];
      if (
        Array.isArray(strings) &&
        'raw' in strings &&
        strings.join('?').includes('FROM app.tasks') &&
        strings.join('?').trim().startsWith('SELECT')
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

export async function checkAgentTaskMetadata(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const project = randomUUID();
  const otherProject = randomUUID();
  const foreignProject = randomUUID();
  const foreignOrg = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const otherWorker = randomUUID();
  const outsider = randomUUID();
  const editor = `metadata-editor-${fx.suffix}`;
  const tokens: string[] = [];
  const sessions = new Set<string>();
  const releaseJobs = await holdAgentJobs(sql, fx.suffix, [
    project,
    otherProject,
  ]);

  const task = (title: string, agentId?: string, status = 'todo') =>
    fx.insertTask({
      projectId: project,
      title,
      status,
      ...(agentId !== undefined ? { agentId } : {}),
    });
  const state = (id: string) => loadTaskOrThrow(sql, id, orgId);
  const counts = async (id: string) => {
    const rows = await sql<
      { runs: number; activity: number; audits: number; hints: number }[]
    >`
      SELECT (SELECT count(*)::int FROM app.project_agent_runs WHERE task_id = ${id}) AS runs,
        (SELECT count(*)::int FROM app.task_activity WHERE task_id = ${id}) AS activity,
        (SELECT count(*)::int FROM app.audit_logs WHERE org_id = ${orgId} AND resource_id = ${id}) AS audits,
        (SELECT count(*)::int FROM app_realtime.outbox WHERE org_id = ${orgId} AND entity = 'task' AND entity_id = ${id}) AS hints
    `;
    return rows[0];
  };
  const dispatch = async (
    token: string,
    args: Body,
    tool = 'task_update_metadata',
  ): Promise<Body> => {
    const response = await fetch(`${base}/api/tools/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, args }),
    });
    const body: unknown = await response.json();
    if (!isRecord(body)) throw new Error('metadata tool returned no object');
    return body;
  };
  const tokenFor = async (
    sessionId: string,
    execId?: string,
    grants = ['task_get', 'task_update_metadata'],
  ) => {
    const token = `itest-metadata-${randomUUID()}`;
    tokens.push(token);
    await insertSessionToken(sql, {
      organizationId: orgId,
      sessionId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
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
  const liveRun = async (
    agentId: string,
    taskId: string,
    sessionId = `pa-${agentId}`,
  ) => {
    const execId = `metadata-${randomUUID()}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (org_id, project_id, task_id, agent_id, exec_id, session_id, status, harness, model, trigger, started_by, started_at_ms, launched_at_ms, deadline_at_ms, updated_at_ms)
      VALUES (${orgId}, ${project}, ${taskId}, ${agentId}, ${execId}, ${sessionId}, 'running', 'claude-code', 'itest-model', 'manual', ${editor}, ${fx.now}, ${fx.now}, ${fx.now + 3_600_000}, ${fx.now}) RETURNING id
    `;
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms) VALUES (${orgId}, ${sessionId}, 'active', 'project_agent', ${agentId}, 'itest:metadata', ${fx.now}, ${fx.now + 3_600_000}) ON CONFLICT DO NOTHING`;
    sessions.add(sessionId);
    return {
      id: rows[0]?.id ?? '',
      execId,
      sessionId,
      token: await tokenFor(sessionId, execId),
    };
  };
  const domain = (tx: TransactionSql, patch: unknown) =>
    updateAgentTaskMetadata(tx, {
      organizationId: orgId,
      projectId: project,
      actorId: manager,
      patch,
    });

  try {
    await fx.insertUser(editor, 'editor');
    await fx.insertProject(project, 'Metadata project');
    await fx.insertProject(otherProject, 'Metadata neighbour');
    const foreignFixtures = fixtures(sql, { ...ctx, orgId: foreignOrg });
    await foreignFixtures.insertProject(foreignProject, 'Other tenant');
    for (const [id, projectId, name] of [
      [manager, project, 'Manager'],
      [worker, project, 'Worker'],
      [otherWorker, project, 'Other worker'],
      [outsider, otherProject, 'Neighbour'],
    ] as const)
      await fx.insertAgent(id, projectId, name);
    const roleTask = await task('Manager role', manager, 'in_progress');
    const issuer = await liveRun(manager, roleTask);
    const target = await task('Idle target');
    const initial = await state(target);
    const changed = await dispatch(issuer.token, {
      taskId: target,
      priority: 'p1',
      agentId: worker,
      expected: { priority: null, assignee: null },
    });
    const stored = await state(target);
    const changedCounts = await counts(target);
    const trail = await sql<
      { actorType: string; actorId: string; action: string }[]
    >`SELECT actor_type AS "actorType", actor_id AS "actorId", action FROM app.task_activity WHERE task_id = ${target} ORDER BY created_at_ms, id`;
    const audit = await sql<
      { actorType: string; actorId: string; metadata: Body }[]
    >`SELECT actor_type AS "actorType", actor_id AS "actorId", metadata FROM app.audit_logs WHERE resource_id = ${target} AND org_id = ${orgId}`;
    record(
      'metadata: live issuer prioritizes and assigns a different idle task without execution, with agent audit and realtime hints',
      changed.status === 'ok' &&
        output(changed).changed === true &&
        stored.priority === 'p1' &&
        stored.assigneeId === worker &&
        stored.status === initial.status &&
        stored.agentRunCount === initial.agentRunCount &&
        changedCounts?.runs === 0 &&
        trail.length === 2 &&
        trail.every(
          (row) => row.actorType === 'agent' && row.actorId === manager,
        ) &&
        audit.length === 2 &&
        audit.every(
          (row) =>
            row.actorType === 'api' &&
            row.actorId === manager &&
            row.metadata.viaAgent === true,
        ) &&
        (changedCounts?.hints ?? 0) >= 2,
      `status=${String(changed.status)} activity=${trail.length} audits=${audit.length} hints=${changedCounts?.hints}`,
    );

    const matching = {
      taskId: target,
      priority: 'p1',
      agentId: worker,
      expected: { priority: 'p1', assignee: { type: 'agent', id: worker } },
    };
    const noop = await dispatch(issuer.token, matching);
    record(
      'metadata: matching no-op returns stored values with no duplicate field trail',
      noop.status === 'ok' &&
        output(noop).changed === false &&
        JSON.stringify(await counts(target)) === JSON.stringify(changedCounts),
      `status=${String(noop.status)} changed=${String(output(noop).changed)}`,
    );
    const stale = await dispatch(issuer.token, {
      ...matching,
      expected: { priority: null, assignee: { type: 'agent', id: worker } },
    });
    record(
      'metadata: desired equality does not excuse stale expected metadata',
      refused(stale, 'TASK_METADATA_STALE') &&
        JSON.stringify(await counts(target)) === JSON.stringify(changedCounts),
      String(stale.message),
    );
    const cleared = await dispatch(issuer.token, {
      taskId: target,
      priority: null,
      agentId: null,
      expected: { priority: 'p1', assignee: { type: 'agent', id: worker } },
    });
    record(
      'metadata: explicit null clears priority and ownership without a run',
      cleared.status === 'ok' &&
        (await state(target)).priority === null &&
        (await state(target)).assigneeId === null &&
        (await counts(target))?.runs === 0,
      `status=${String(cleared.status)}`,
    );

    for (const invalid of [
      { taskId: target, priority: 'p0', expected: {} },
      { taskId: target, agentId: null, expected: {} },
      {
        taskId: target,
        priority: 'p0',
        expected: { priority: null },
        status: 'done',
      },
      {
        taskId: target,
        priority: 'p0',
        expected: { priority: null },
        reviewerUserId: userId,
      },
    ]) {
      const before = await state(target);
      const result = await dispatch(issuer.token, invalid);
      record(
        'metadata: omitted expectations or protected fields refuse the complete request',
        result.status === 'invalid_args' &&
          JSON.stringify(await state(target)) === JSON.stringify(before),
        JSON.stringify(Object.keys(invalid)),
      );
    }
    const oldGrants = AGENT_TOOL_CATALOG.map((entry) => entry.name).filter(
      (name) => name !== 'task_update_metadata',
    );
    const ungranted = await dispatch(
      await tokenFor(issuer.sessionId, issuer.execId, oldGrants),
      { taskId: target, priority: 'p0', expected: { priority: null } },
    );
    record(
      'metadata: every old grant together still grants no metadata write',
      ungranted.status === 'unavailable' &&
        JSON.stringify(ungranted).includes('not_granted') &&
        (await state(target)).priority === null,
      `status=${String(ungranted.status)}`,
    );
    const legacy = await dispatch(await tokenFor(issuer.sessionId), {
      taskId: target,
      priority: 'p0',
      expected: { priority: null },
    });
    record(
      'metadata: a legacy token without its own live exec cannot use the new tool',
      legacy.status === 'unavailable' &&
        (await state(target)).priority === null,
      `status=${String(legacy.status)}`,
    );

    const foreign = await fx.insertTask({
      projectId: otherProject,
      title: 'Neighbour task',
    });
    const foreignTenantTask = await foreignFixtures.insertTask({
      projectId: foreignProject,
      title: 'Other tenant task',
    });
    const missing = await dispatch(issuer.token, {
      taskId: randomUUID(),
      priority: 'p0',
      expected: { priority: null },
    });
    const foreignResult = await dispatch(issuer.token, {
      taskId: foreign,
      priority: 'p0',
      expected: { priority: null },
    });
    const foreignTenantResult = await dispatch(issuer.token, {
      taskId: foreignTenantTask,
      priority: 'p0',
      expected: { priority: null },
    });
    record(
      'metadata: foreign-project and foreign-organization tasks are indistinguishable from missing and unchanged',
      missing.status === 'not_found' &&
        JSON.stringify(missing) === JSON.stringify(foreignResult) &&
        JSON.stringify(missing) === JSON.stringify(foreignTenantResult) &&
        (await state(foreign)).priority === null &&
        (await loadTaskOrThrow(sql, foreignTenantTask, foreignOrg)).priority ===
          null,
      `missing=${String(missing.status)} project=${String(foreignResult.status)} tenant=${String(foreignTenantResult.status)}`,
    );
    const wrongAgent = await dispatch(issuer.token, {
      taskId: target,
      priority: 'p0',
      agentId: outsider,
      expected: { priority: null, assignee: null },
    });
    record(
      'metadata: a wrong-project agent refuses a combined priority edit too',
      refused(wrongAgent, 'AGENT_NOT_ALLOWED_IN_PROJECT') &&
        (await state(target)).priority === null &&
        (await state(target)).assigneeId === null,
      String(wrongAgent.message),
    );
    await sql`UPDATE app.tasks SET archived_at_ms = ${Date.now()} WHERE id = ${target}`;
    const archivedTask = await dispatch(issuer.token, {
      taskId: target,
      priority: 'p0',
      expected: { priority: null },
    });
    await sql`UPDATE app.tasks SET archived_at_ms = NULL WHERE id = ${target}`;
    await sql`UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${project}`;
    const archivedProject = await dispatch(issuer.token, {
      taskId: target,
      priority: 'p0',
      expected: { priority: null },
    });
    await sql`UPDATE app.projects SET archived_at_ms = NULL WHERE id = ${project}`;
    record(
      'metadata: archived task and project refuse writes',
      refused(archivedTask, 'TASK_ARCHIVED') &&
        refused(archivedProject, 'PROJECT_ARCHIVED') &&
        (await state(target)).priority === null,
      `task=${String(archivedTask.message)} project=${String(archivedProject.message)}`,
    );

    const reviewing = await task('Human review', worker, 'in_review');
    await sql`UPDATE app.tasks SET reviewer_user_id = ${userId} WHERE id = ${reviewing}`;
    const approvals = await sql<
      { id: string }[]
    >`INSERT INTO app.approvals (org_id, resource_type, resource_id, status, metadata, created_at_ms) VALUES (${orgId}, 'task_review', ${reviewing}, 'pending', ${sql.json({ taskId: reviewing, projectId: project, requestedFor: userId, round: 1 })}, ${fx.now}) RETURNING id`;
    const approvalId = approvals[0]?.id ?? '';
    const beforeReview =
      await sql`SELECT * FROM app.approvals WHERE id = ${approvalId}`;
    const ownerRefused = await dispatch(issuer.token, {
      taskId: reviewing,
      priority: 'p0',
      agentId: otherWorker,
      expected: { priority: null, assignee: { type: 'agent', id: worker } },
    });
    const priorityOnly = await dispatch(issuer.token, {
      taskId: reviewing,
      priority: 'p0',
      expected: { priority: null },
    });
    const reviewedState = await state(reviewing);
    record(
      'metadata: owner change leaves a human handoff intact; priority alone preserves approval, reviewer, status and owner',
      refused(ownerRefused, 'TASK_METADATA_OWNER_PROTECTED') &&
        priorityOnly.status === 'ok' &&
        reviewedState.assigneeId === worker &&
        reviewedState.reviewerUserId === userId &&
        reviewedState.status === 'in_review' &&
        reviewedState.priority === 'p0' &&
        JSON.stringify(
          await sql`SELECT * FROM app.approvals WHERE id = ${approvalId}`,
        ) === JSON.stringify(beforeReview),
      `ownership=${String(ownerRefused.status)} priority=${String(priorityOnly.status)}`,
    );
    await sql`UPDATE app.tasks SET status = 'todo' WHERE id = ${reviewing}`;
    const pendingDespiteStatus = await dispatch(issuer.token, {
      taskId: reviewing,
      agentId: null,
      expected: { assignee: { type: 'agent', id: worker } },
    });
    record(
      'metadata: a still-pending review protects ownership even under an open column',
      refused(pendingDespiteStatus, 'TASK_METADATA_OWNER_PROTECTED') &&
        (await state(reviewing)).assigneeId === worker,
      String(pendingDespiteStatus.message),
    );

    const askedTask = await task('Human question', worker, 'in_progress');
    const runs = await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx<
        { id: string }[]
      >`INSERT INTO app.automation_runs (org_id, project_id, name, version, status, mode, started_by, input, detail, started_at_ms) VALUES (${orgId}, ${project}, ${`itest/metadata-${fx.suffix}`}, 1, 'waiting', 'live', ${editor}, ${sql.json({ task: { id: askedTask } })}, 'agent:triage', ${fx.now}) RETURNING id`;
    });
    const automationId = runs[0]?.id ?? '';
    const asks = await sql<
      { id: string }[]
    >`INSERT INTO app.automation_human_asks (org_id, run_id, node_id, session_id, exec_id, question, status, expires_at_ms, task_id, created_at_ms) VALUES (${orgId}, ${automationId}, 'triage', ${`wf-${fx.suffix}`}, 'exec-ask', 'Which path?', 'pending', ${fx.now + 3_600_000}, ${askedTask}, ${fx.now}) RETURNING id`;
    const askId = asks[0]?.id ?? '';
    const beforeAsk =
      await sql`SELECT * FROM app.automation_human_asks WHERE id = ${askId}`;
    const questionRefused = await dispatch(issuer.token, {
      taskId: askedTask,
      agentId: null,
      expected: { assignee: { type: 'agent', id: worker } },
    });
    const questionPriority = await dispatch(issuer.token, {
      taskId: askedTask,
      priority: 'p2',
      expected: { priority: null },
    });
    record(
      'metadata: an automation awaiting a person holds ownership and its question survives priority triage',
      refused(questionRefused, 'TASK_HAS_LIVE_RUN') &&
        questionPriority.status === 'ok' &&
        JSON.stringify(
          await sql`SELECT * FROM app.automation_human_asks WHERE id = ${askId}`,
        ) === JSON.stringify(beforeAsk) &&
        (await state(askedTask)).assigneeId === worker,
      `owner=${String(questionRefused.status)} priority=${String(questionPriority.status)}`,
    );

    // A running issuer may be assigned an idle task, but a live target held
    // by another worker must not be transferred to that issuer.
    const liveTarget = await task('Live worker', worker, 'in_progress');
    await liveRun(worker, liveTarget);
    const toSelf = await dispatch(issuer.token, {
      taskId: liveTarget,
      agentId: manager,
      expected: { assignee: { type: 'agent', id: worker } },
    });
    const idleSelf = await dispatch(issuer.token, {
      taskId: target,
      agentId: manager,
      expected: { assignee: null },
    });
    record(
      'metadata: target occupancy blocks transfer to the running issuer; assigning that issuer an idle target starts nothing',
      refused(toSelf, 'TASK_HAS_LIVE_RUN') &&
        idleSelf.status === 'ok' &&
        (await counts(target))?.runs === 0 &&
        (await state(liveTarget)).assigneeId === worker,
      `live=${String(toSelf.status)} idle=${String(idleSelf.status)}`,
    );

    // Provoke a failure AFTER the assignment writer: the existing edit
    // writer rejects inconsistent legacy dates. The whole transaction,
    // including assignment activity/audit/outbox, must roll back.
    const rollback = await task('Rollback');
    await sql`UPDATE app.tasks SET start_date_ms = 2000, due_date_ms = 1000 WHERE id = ${rollback}`;
    const beforeRollback = await state(rollback);
    const rollbackCounts = await counts(rollback);
    const rollbackResult = await dispatch(issuer.token, {
      taskId: rollback,
      priority: 'p1',
      agentId: otherWorker,
      expected: { priority: null, assignee: null },
    });
    record(
      'metadata: failure after assignment rolls back both fields and the whole change trail',
      refused(rollbackResult, 'TASK_SCHEDULE_INVALID') &&
        JSON.stringify(await state(rollback)) ===
          JSON.stringify(beforeRollback) &&
        JSON.stringify(await counts(rollback)) ===
          JSON.stringify(rollbackCounts),
      String(rollbackResult.message),
    );

    const firstReady = latch();
    const releaseFirst = latch();
    const secondRead = latch();
    const concurrent = await task('Concurrent triage');
    const first = transactSerializable(sql, async (tx) => {
      const result = await domain(tx, {
        taskId: concurrent,
        priority: 'p1',
        expected: { priority: null },
      });
      firstReady.release();
      await bounded(releaseFirst.ready);
      return result;
    });
    let second: Promise<unknown> | undefined;
    try {
      await bounded(firstReady.ready);
      second = transactSerializable(sql, (tx) =>
        domain(observeTaskRead(tx, secondRead.release), {
          taskId: concurrent,
          priority: 'p2',
          expected: { priority: null },
        }),
      ).then(
        () => 'unexpected-write',
        (error: unknown) => (isRecord(error) ? error.code : String(error)),
      );
      await bounded(secondRead.ready);
    } finally {
      releaseFirst.release();
    }
    const concurrentResult = await bounded(Promise.all([first, second]));
    record(
      'metadata: concurrent expected-value writers share the real task lock and the loser retries into a stale refusal',
      concurrentResult[1] === 'TASK_METADATA_STALE' &&
        (await state(concurrent)).priority === 'p1' &&
        (await counts(concurrent))?.activity === 1,
      `second=${String(concurrentResult[1])}`,
    );

    // Ordered, overlapping snapshots in both directions: no timing gamble.
    for (const metadataFirst of [true, false]) {
      const a = randomUUID();
      const b = randomUUID();
      await fx.insertAgent(a, project, 'Race first worker');
      await fx.insertAgent(b, project, 'Race next worker');
      const targetId = await task(`Start race ${metadataFirst}`, a);
      const wrote = latch();
      const release = latch();
      const read = latch();
      const triage = (tx: TransactionSql) =>
        domain(tx, {
          taskId: targetId,
          agentId: b,
          expected: { assignee: { type: 'agent', id: a } },
        });
      const start = (tx: TransactionSql) =>
        startDelegatedAgentRun(tx, {
          organizationId: orgId,
          scopeProjectIds: [project],
          taskId: targetId,
          startedBy: editor,
          via: { kind: 'agent', runId: issuer.id, agentId: manager },
          moveToInProgress: false,
        });
      const winner = transactSerializable(sql, async (tx) => {
        const result = metadataFirst ? await triage(tx) : await start(tx);
        wrote.release();
        await bounded(release.ready);
        return result;
      });
      let follower: Promise<unknown> | undefined;
      try {
        await bounded(wrote.ready);
        follower = transactSerializable(sql, async (tx) =>
          metadataFirst
            ? await start(observeTaskRead(tx, read.release))
            : await triage(observeTaskRead(tx, read.release)),
        ).then(
          (value) => value,
          (error: unknown) => (isRecord(error) ? error.code : String(error)),
        );
        await bounded(read.ready);
      } finally {
        release.release();
      }
      const results = await bounded(Promise.all([winner, follower]));
      const finalRuns = await runsOf(sql, targetId);
      const finalTask = await state(targetId);
      const expectedAgent = metadataFirst ? b : a;
      record(
        `metadata: real start/assignment race (${metadataFirst ? 'metadata first' : 'start first'}) keeps the started agent and durable owner identical`,
        finalRuns.length === 1 &&
          finalRuns[0]?.agentId === expectedAgent &&
          finalTask.assigneeId === expectedAgent &&
          (metadataFirst || results[1] === 'TASK_HAS_LIVE_RUN'),
        `runs=${finalRuns.length} ownerMatches=${finalTask.assigneeId === finalRuns[0]?.agentId} follower=${typeof results[1] === 'string' ? results[1] : 'accepted'}`,
      );
    }

    await fx.setRole(editor, 'member');
    const demoted = await dispatch(issuer.token, {
      taskId: target,
      priority: 'p0',
      expected: { priority: null },
    });
    await fx.setRole(editor, 'editor');
    record(
      'metadata: the issuer starter losing project edit authority revokes triage',
      demoted.status === 'unavailable' &&
        (await state(target)).priority === null,
      `status=${String(demoted.status)}`,
    );
    const memberAgent = randomUUID();
    await fx.insertAgent(memberAgent, project, 'Confined');
    const memberTask = await task('Member workspace', memberAgent);
    const memberRun = await liveRun(
      memberAgent,
      memberTask,
      memberSessionIdForProjectAgent(memberAgent, editor),
    );
    const confined = await dispatch(memberRun.token, {
      taskId: memberTask,
      priority: 'p0',
      expected: { priority: null },
    });
    record(
      'metadata: a member workspace stays confined even after its starter is an editor',
      confined.status === 'unavailable' &&
        (await state(memberTask)).priority === null,
      `status=${String(confined.status)}`,
    );
    await sql`UPDATE app.project_agent_runs SET status = 'settled', settled_at_ms = ${Date.now()} WHERE id = ${issuer.id}`;
    const ended = await dispatch(issuer.token, {
      taskId: target,
      priority: 'p0',
      expected: { priority: null },
    });
    record(
      'metadata: a finished issuer cannot continue triage with its old token',
      ended.status === 'unavailable' &&
        JSON.stringify(ended).includes('run_ended') &&
        (await state(target)).priority === null,
      `status=${String(ended.status)}`,
    );
  } finally {
    await releaseJobs();
    await sql`DELETE FROM app.sandbox_session_tokens WHERE token_hash = ANY(${tokens.map((token) => createHash('sha256').update(token).digest('hex'))})`;
    await sql`DELETE FROM app.sandbox_sessions WHERE session_id = ANY(${[...sessions]})`;
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx`DELETE FROM app.automation_runs WHERE org_id = ${orgId} AND name = ${`itest/metadata-${fx.suffix}`}`;
    });
    await sql`DELETE FROM app.approvals WHERE org_id = ${orgId} AND metadata ->> 'projectId' = ${project}`;
    await sql`DELETE FROM app.projects WHERE id = ANY(${[project, otherProject, foreignProject]})`;
    await fx.teardownUsers();
  }
}
