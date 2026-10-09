/** Extends the existing inert native review lane. Its parent holds every
 * agent job and owns synthetic users, sessions, policies and cleanup. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { TaskAgentReviewInput } from '@tale/shared/schemas/task-review';
import type { Sql } from 'postgres';

import { createTaskList } from '../../jobs/task-list.ts';
import { deleteOrganization } from '../organizations/service.ts';
import { deleteProject, type ProjectAuthContext } from '../projects/service.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import { cancelAgentRunInTx, failAgentRunFromTurn } from './agent-runs.ts';
import {
  type Fixtures,
  type Recorder,
  runsOf,
} from './delegated-start.integration.ts';
import { retireTasksInTx } from './retire.ts';
import { projectReviewBatch, readReviewBatch } from './review-batch-store.ts';
import { checkReviewContextRaces } from './review-context-races.integration.ts';
import { updateTaskReviewContextConfiguration } from './review-context.ts';
import { getPendingReviewForTask, requestTaskReview } from './reviews.ts';
import { loadTaskOrThrow } from './service.ts';

type Body = Record<string, unknown>;
const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const output = (value: Body): Body =>
  isRecord(value.output) ? value.output : {};

interface Fixture {
  sql: Sql;
  orgId: string;
  projectId: string;
  implementerId: string;
  auth: ProjectAuthContext;
  fx: Fixtures;
  sessions: Set<string>;
  record: Recorder;
  inputFor: (taskId: string) => Promise<TaskAgentReviewInput>;
  dispatch: (token: string, args: unknown, tool?: string) => Promise<Body>;
  tokenFor: (
    sessionId: string,
    execId?: string,
    grants?: string[],
  ) => Promise<string>;
  addRun: (
    taskId: string,
    agentId: string,
    status?: string,
    sessionId?: string,
  ) => Promise<{ id: string; execId: string; sessionId: string }>;
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

export async function checkReviewBatches(f: Fixture): Promise<void> {
  const { sql, orgId, projectId, fx, record } = f;
  const report = (name: string, ok: boolean, detail = '') =>
    record(`review batch: ${name}`, ok, detail);
  const manager = randomUUID();
  const reviewer = randomUUID();
  const contextTaskId = await fx.insertTask({
    projectId,
    title: 'Managed review context',
  });
  const enroll = {
    projectId,
    taskId: contextTaskId,
    reviewerAgentId: reviewer,
    enabled: true,
  };
  const contexts = [contextTaskId];
  const holdIds: string[] = [];
  const ownedRunIds = new Set<string>();
  try {
    await fx.insertAgent(manager, projectId, 'Review batch manager');
    await fx.insertAgent(reviewer, projectId, 'Review batch reviewer');
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review','task_start_agent','task_get']::text[] WHERE id = ${manager}`;
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review','task_get']::text[] WHERE id = ${reviewer}`;
    await checkReviewContextRaces({
      sql,
      orgId,
      projectId,
      reviewerAgentId: reviewer,
      auth: f.auth,
      fx,
      record,
    });
    await transactSerializable(sql, (tx) =>
      updateTaskReviewContextConfiguration(tx, f.auth, enroll, null),
    );
    const managerTask = await fx.insertTask({
      projectId,
      title: 'Batch manager role',
      agentId: manager,
      status: 'in_progress',
    });
    const issuer = await f.addRun(managerTask, manager, 'running');
    const apiKeyId = `itest-review-key-${randomUUID()}`;
    await sql`UPDATE app.project_agent_runs SET api_key_id = ${apiKeyId}
      WHERE org_id = ${orgId} AND id = ${issuer.id}`;
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${issuer.sessionId}, 'active', 'project_agent', ${manager}, 'itest:review-batch', ${fx.now}, ${fx.now + 3_600_000})`;
    f.sessions.add(issuer.sessionId);
    const managerToken = await f.tokenFor(issuer.sessionId, issuer.execId, [
      'task_review',
      'task_start_agent',
      'task_get',
    ]);
    const target = async (title: string) => {
      const taskId = await fx.insertTask({
        projectId,
        title,
        status: 'in_review',
        agentId: f.implementerId,
      });
      const source = await f.addRun(taskId, f.implementerId);
      await sql`UPDATE app.tasks SET reviewer_agent_id = ${reviewer} WHERE id = ${taskId}`;
      await transactSerializable(sql, async (tx) =>
        requestTaskReview(tx, {
          task: await loadTaskOrThrow(tx, taskId, orgId),
          trigger: { kind: 'agent_run', runId: source.id },
        }),
      );
      return f.inputFor(taskId);
    };
    const first = await target('First declared source');
    const second = await target('Second declared source');
    const declared = [first, second];
    for (let index = 2; index < 20; index++)
      declared.push(await target(`Declared source ${index + 1}`));
    const undeclared = await target('Not in this envelope');
    const start = {
      operation: 'start_batch',
      requestId: randomUUID(),
      contextTaskId,
      targets: declared.map(({ taskId, expected }) => ({
        taskId,
        expected,
      })),
    };
    const overflow = await f.dispatch(managerToken, {
      ...start,
      targets: [
        ...start.targets,
        { taskId: undeclared.taskId, expected: undeclared.expected },
      ],
    });
    report(
      'a twenty-first target refuses before native admission',
      overflow.status === 'invalid_args' &&
        (await runsOf(sql, contextTaskId)).length === 0,
      JSON.stringify(overflow),
    );
    const starts = await Promise.all([
      f.dispatch(managerToken, start),
      f.dispatch(managerToken, start),
    ]);
    const admitted = output(starts[0] ?? {});
    const batch = isRecord(admitted.batch) ? admitted.batch : {};
    const batchId = typeof batch.batchId === 'string' ? batch.batchId : '';
    const initialRuns = await runsOf(sql, contextTaskId);
    report(
      'concurrent exact twenty-target requests admit one native run and one fixed envelope',
      starts.every(
        (answer) =>
          answer.status === 'ok' && output(answer).outcome === 'review_batch',
      ) &&
        batchId !== '' &&
        Array.isArray(batch.targets) &&
        batch.targets.length === 20 &&
        initialRuns.length === 1 &&
        batch.outcome === 'incomplete',
      JSON.stringify(starts),
    );
    const run = initialRuns[0];
    if (run === undefined || batchId === '')
      throw new Error('Native batch fixture was not admitted');
    ownedRunIds.add(run.id);
    const admittedKey = await sql<{ apiKeyId: string | null }[]>`
      SELECT api_key_id AS "apiKeyId" FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND id = ${run.id}`;
    report(
      'native batch inherits its manager run API key',
      admittedKey[0]?.apiKeyId === apiKeyId,
    );
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${run.sessionId}, 'active', 'project_agent', ${reviewer}, 'itest:review-batch', ${fx.now}, ${fx.now + 3_600_000})`;
    f.sessions.add(run.sessionId);
    const reviewerToken = await f.tokenFor(run.sessionId, run.execId);
    const outside = await f.dispatch(reviewerToken, undeclared);
    report(
      'native reviewer cannot substitute an undeclared target',
      outside.status === 'invalid_args' &&
        String(outside.message).startsWith('TASK_REVIEW_FORBIDDEN:') &&
        (await loadTaskOrThrow(sql, undeclared.taskId, orgId)).status ===
          'in_review',
    );
    const approved = await f.dispatch(reviewerToken, first);
    report(
      'first native decision consumes only its declared captured source',
      approved.status === 'ok' &&
        (await loadTaskOrThrow(sql, first.taskId, orgId)).status === 'done' &&
        (await loadTaskOrThrow(sql, second.taskId, orgId)).status ===
          'in_review',
    );
    await transactSerializable(sql, (tx) =>
      completeAgentRunInTx(tx, {
        organizationId: orgId,
        taskId: contextTaskId,
        agentId: reviewer,
        runId: run.id,
        execId: run.execId,
        files: [],
        body: 'Targets remain; report is not proof.',
        resultText: 'Targets remain; report is not proof.',
      }),
    );
    const replay = output(await f.dispatch(managerToken, start));
    report(
      'settled partial batch stays incomplete on replay without a new report gate or run',
      replay.replayed === true &&
        isRecord(replay.batch) &&
        replay.batch.outcome === 'incomplete' &&
        (await runsOf(sql, contextTaskId)).length === 1 &&
        (await getPendingReviewForTask(sql, orgId, contextTaskId)) === null &&
        (await loadTaskOrThrow(sql, contextTaskId, orgId)).status === 'todo',
    );
    const remainingStart = {
      ...start,
      requestId: randomUUID(),
      targets: declared
        .slice(1)
        .map(({ taskId, expected }) => ({ taskId, expected })),
    };
    const remaining = output(await f.dispatch(managerToken, remainingStart));
    const nextBatch = isRecord(remaining.batch) ? remaining.batch : {};
    const next = (await runsOf(sql, contextTaskId)).at(-1);
    if (
      next === undefined ||
      next.id === run.id ||
      typeof nextBatch.batchId !== 'string'
    )
      throw new Error(
        'Remaining target did not get its new declared occurrence',
      );
    const nextBatchId = nextBatch.batchId;
    ownedRunIds.add(next.id);
    const nextToken = await f.tokenFor(next.sessionId, next.execId);
    const changes = await f.dispatch(nextToken, {
      ...second,
      decision: 'request_changes',
      feedback: 'Repair the independently reviewed defect before approval.',
    });
    const remainingDecisions = [];
    for (const remainingTarget of declared.slice(2))
      remainingDecisions.push(await f.dispatch(nextToken, remainingTarget));
    await transactSerializable(sql, (tx) =>
      completeAgentRunInTx(tx, {
        organizationId: orgId,
        taskId: contextTaskId,
        agentId: reviewer,
        runId: next.id,
        execId: next.execId,
        files: [],
        body: 'Native changes requested.',
        resultText: 'Native changes requested.',
      }),
    );
    const completed = output(
      await f.dispatch(managerToken, {
        operation: 'read_batch',
        batchId: nextBatchId,
      }),
    );
    const prior = output(
      await f.dispatch(managerToken, { operation: 'read_batch', batchId }),
    );
    report(
      'new occurrence attests remaining changes-requested action without laundering another batch receipt',
      changes.status === 'ok' &&
        remainingDecisions.length === 18 &&
        remainingDecisions.every((decision) => decision.status === 'ok') &&
        Array.isArray(completed.targets) &&
        completed.targets.length === 19 &&
        completed.outcome === 'complete' &&
        prior.outcome === 'incomplete' &&
        (await loadTaskOrThrow(sql, second.taskId, orgId)).status === 'todo' &&
        (await getPendingReviewForTask(sql, orgId, contextTaskId)) === null,
    );
    // A separate owned context keeps the first occurrence's exact replay
    // assertions independent of retry lineage and its per-task start budget.
    const retryContextId = await fx.insertTask({
      projectId,
      title: 'Managed review retry context',
    });
    contexts.push(retryContextId);
    await transactSerializable(sql, (tx) =>
      updateTaskReviewContextConfiguration(
        tx,
        f.auth,
        { ...enroll, taskId: retryContextId },
        null,
      ),
    );
    const retryAdmission = output(
      await f.dispatch(managerToken, {
        operation: 'start_batch',
        requestId: randomUUID(),
        contextTaskId: retryContextId,
        targets: [{ taskId: undeclared.taskId, expected: undeclared.expected }],
      }),
    );
    const retryBatch = isRecord(retryAdmission.batch)
      ? retryAdmission.batch
      : {};
    const retrySource = (await runsOf(sql, retryContextId))[0];
    if (retrySource === undefined || typeof retryBatch.batchId !== 'string')
      throw new Error('Retry context was not admitted');
    ownedRunIds.add(retrySource.id);
    await failAgentRunFromTurn(sql, {
      runId: retrySource.id,
      execId: retrySource.execId,
      error: 'Owned inert retry-binding probe',
      failureCode: 'turn_crashed',
    });
    const retryEvidence = async () => ({
      runs: await sql`SELECT * FROM app.project_agent_runs WHERE task_id = ${retryContextId} ORDER BY seq`,
      jobs: await sql`SELECT id, state, data, start_after FROM pgboss.job
        WHERE name = 'task.agent_retry' AND data ->> 'expectedRunId' = ${retrySource.id} ORDER BY id`,
    });
    const beforeLegacyRetry = await retryEvidence();
    const legacyRetry = await refusal(() =>
      sql.begin(async (tx) => {
        // A legacy-shaped storage write, not execution of a released binary.
        // Its missing batch binding must abort even an earlier retry marker.
        await tx`UPDATE app.project_agent_runs SET auto_retry_refused_at_ms = ${Date.now()} WHERE id = ${retrySource.id}`;
        await tx`INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, deadline_at_ms, updated_at_ms,
        started_via, started_via_run_id, started_via_agent_id, in_place,
        in_place_retry_status, in_place_retry_activity_id
      ) SELECT org_id, project_id, task_id, agent_id, ${randomUUID()}, session_id, 'queued',
        harness, model, started_by, started_at_ms, deadline_at_ms, updated_at_ms,
        started_via, started_via_run_id, started_via_agent_id, in_place,
        in_place_retry_status, in_place_retry_activity_id
        FROM app.project_agent_runs WHERE id = ${retrySource.id}`;
      }),
    );
    report(
      'legacy retry without the envelope rolls back without dropping pending retry evidence',
      legacyRetry === '23514' &&
        beforeLegacyRetry.jobs.length === 1 &&
        JSON.stringify(await retryEvidence()) ===
          JSON.stringify(beforeLegacyRetry),
    );
    const retryJobs = await sql<{ data: unknown }[]>`SELECT data FROM pgboss.job
      WHERE name = 'task.agent_retry' AND data ->> 'expectedRunId' = ${retrySource.id}`;
    const retryWorker = createTaskList({ sql })['task.agent_retry'];
    if (retryWorker === undefined || retryJobs.length !== 1)
      throw new Error('Expected one held native review retry');
    await retryWorker(retryJobs[0]?.data);
    const retryRuns = await sql<
      {
        id: string;
        batchId: string | null;
        inPlace: boolean;
        status: string;
        apiKeyId: string | null;
      }[]
    >`
      SELECT id, review_batch_id AS "batchId", in_place AS "inPlace", status, api_key_id AS "apiKeyId"
      FROM app.project_agent_runs WHERE task_id = ${retryContextId} ORDER BY seq`;
    report(
      'maintained retry keeps the same envelope and in-place authority',
      retryRuns.length === 2 &&
        retryRuns[0]?.status === 'failed' &&
        retryRuns[1]?.status === 'queued' &&
        retryRuns.every(
          (row) =>
            row.inPlace &&
            row.batchId === retryBatch.batchId &&
            row.apiKeyId === apiKeyId,
        ),
    );
    for (const retried of retryRuns) ownedRunIds.add(retried.id);
    const retryRun = retryRuns[1];
    if (retryRun !== undefined)
      await transactSerializable(sql, (tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          taskId: retryContextId,
          runId: retryRun.id,
        }),
      );
    const oldWriter = await refusal(() => f.addRun(contextTaskId, reviewer));
    report(
      'legacy run insertion without a batch refuses only the opted-in context',
      oldWriter === '23514',
    );
    const status = await refusal(
      () =>
        sql`UPDATE app.tasks SET status = 'in_review' WHERE id = ${contextTaskId}`,
    );
    const approval = await refusal(
      () => sql`INSERT INTO app.approvals (org_id, resource_type, resource_id, status, created_at_ms)
      VALUES (${orgId}, 'task_review', ${contextTaskId}, 'pending', ${Date.now()})`,
    );
    report(
      'old explicit status and approval writers cannot recreate a report gate',
      status === '23514' && approval === '23514',
    );
    const reclassify = await refusal(
      () =>
        sql`UPDATE app.tasks SET review_context = false WHERE id = ${contextTaskId}`,
    );
    const falseSidecar = await refusal(
      () =>
        sql`UPDATE app.task_review_contexts SET task_review_context = false WHERE task_id = ${contextTaskId}`,
    );
    report(
      'review purpose cannot be removed or reclassified by an old generic writer',
      reclassify === '23514' && falseSidecar === '23514',
    );
    const snapshot = await runsOf(sql, contextTaskId);
    const driveJobIds = async () => sql<
      { id: string }[]
    >`SELECT id FROM pgboss.job
      WHERE name = 'task.agent_drive' AND data ->> 'runId' = ${next.id} ORDER BY id`;
    const priorDriveJobs = await driveJobIds();
    const oldDelete = await refusal(() =>
      sql.begin(async (tx) => {
        await tx`UPDATE app.tasks SET description = 'must roll back' WHERE id = ${contextTaskId}`;
        await tx`UPDATE app.project_agent_runs SET status = 'running', settled_at_ms = NULL WHERE id = ${next.id}`;
        await cancelAgentRunInTx(tx, {
          organizationId: orgId,
          taskId: contextTaskId,
          runId: next.id,
        });
        await tx`DELETE FROM app.tasks WHERE id = ${contextTaskId}`;
      }),
    );
    report(
      'legacy delete restriction rolls back earlier mutations and transactional cancellation',
      oldDelete === '23503' &&
        JSON.stringify(await runsOf(sql, contextTaskId)) ===
          JSON.stringify(snapshot) &&
        JSON.stringify(await driveJobIds()) ===
          JSON.stringify(priorDriveJobs) &&
        (await loadTaskOrThrow(sql, contextTaskId, orgId)).description !==
          'must roll back',
    );
    const holdId = randomUUID();
    holdIds.push(holdId);
    const retainedEvidence = async () => ({
      contexts: await sql`SELECT * FROM app.task_review_contexts
        WHERE org_id = ${orgId} AND task_id = ANY(${contexts}) ORDER BY task_id`,
      batches: await sql`SELECT * FROM app.task_review_batches
        WHERE org_id = ${orgId} AND context_task_id = ANY(${contexts}) ORDER BY id`,
      runs: await sql`SELECT * FROM app.project_agent_runs
        WHERE org_id = ${orgId} AND task_id = ANY(${contexts}) ORDER BY seq`,
    });
    const beforeHeldRetirement = await retainedEvidence();
    await sql`INSERT INTO app.legal_holds (id, org_id, target_type, target_id, target_label, reason, placed_by, placed_at_ms)
      VALUES (${holdId}, ${orgId}, 'org', ${orgId}, 'Synthetic review-batch tenant', 'Owned preservation probe', ${f.auth.userId}, ${Date.now()})`;
    const held = await refusal(() =>
      transactSerializable(sql, (tx) =>
        retireTasksInTx(tx, {
          organizationId: orgId,
          projectId,
          taskIds: [contextTaskId],
          closedReason: 'task_deleted',
        }),
      ),
    );
    report(
      'maintained retirement refuses held context evidence before any destruction',
      held === 'LEGAL_HOLD_ACTIVE' &&
        JSON.stringify(await retainedEvidence()) ===
          JSON.stringify(beforeHeldRetirement),
    );
    const orgRows = await sql<
      { name: string }[]
    >`SELECT name FROM "organization" WHERE id = ${orgId}`;
    const projectHeld = await refusal(() =>
      transactSerializable(sql, (tx) =>
        deleteProject(tx, f.auth, { projectId, mode: 'detach' }),
      ),
    );
    const orgHeld = await refusal(() =>
      transactSerializable(sql, (tx) =>
        deleteOrganization(
          tx,
          { userId: f.auth.userId },
          orgId,
          orgRows[0]?.name ?? '',
        ),
      ),
    );
    report(
      'project and organization retirement keep held operational evidence',
      projectHeld === 'LEGAL_HOLD_ACTIVE' &&
        orgHeld === 'LEGAL_HOLD_ACTIVE' &&
        JSON.stringify(await retainedEvidence()) ===
          JSON.stringify(beforeHeldRetirement),
    );
    await sql`DELETE FROM app.legal_holds WHERE id = ${holdId}`;
    const custodianHold = randomUUID();
    holdIds.push(custodianHold);
    const starters = await sql<
      { startedBy: string }[]
    >`SELECT started_by AS "startedBy" FROM app.project_agent_runs WHERE id = ${next.id}`;
    const runStarter = starters[0]?.startedBy;
    if (runStarter === undefined)
      throw new Error('Expected retained review run starter');
    await sql`INSERT INTO app.legal_holds (id, org_id, target_type, target_id, target_label, reason, placed_by, placed_at_ms)
      VALUES (${custodianHold}, ${orgId}, 'userMembership', ${runStarter}, 'Synthetic review custodian', 'Owned preservation probe', ${f.auth.userId}, ${Date.now()})`;
    // Make the context agent-created to isolate the held run starter from
    // the author check. This changes no ordinary artifact's custody policy.
    await sql`UPDATE app.tasks SET created_by_type = 'agent', created_by = ${reviewer} WHERE id = ${contextTaskId}`;
    const runCustodianHeld = await refusal(() =>
      transactSerializable(sql, (tx) =>
        retireTasksInTx(tx, {
          organizationId: orgId,
          projectId,
          taskIds: [contextTaskId],
          closedReason: 'task_deleted',
        }),
      ),
    );
    report(
      'held run starter preserves context evidence independently of its author',
      runCustodianHeld === 'LEGAL_HOLD_ACTIVE' &&
        JSON.stringify(await retainedEvidence()) ===
          JSON.stringify(beforeHeldRetirement),
    );
    await sql`DELETE FROM app.legal_holds WHERE id = ${custodianHold}`;
    await sql`DELETE FROM app.project_agent_runs WHERE id = ${next.id}`;
    const afterRetention = await transactSerializable(sql, async (tx) =>
      projectReviewBatch(
        tx,
        await readReviewBatch(tx, orgId, projectId, nextBatchId),
      ),
    );
    report(
      'ordinary issuer retention is not FK-blocked and missing evidence becomes incomplete',
      afterRetention.outcome === 'incomplete',
    );
    await transactSerializable(sql, (tx) =>
      retireTasksInTx(tx, {
        organizationId: orgId,
        projectId,
        taskIds: [contextTaskId],
        closedReason: 'task_deleted',
      }),
    );
    const removed = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM app.task_review_batches WHERE context_task_id = ${contextTaskId}`;
    report(
      'authorized unheld retirement removes context and owned batches together',
      removed[0]?.n === 0,
    );
    await sql`UPDATE app.project_agent_runs SET status = 'settled', settled_at_ms = ${Date.now()} WHERE id = ${issuer.id}`;
  } finally {
    // Only this helper's synthetic rows; the parent still owns its held jobs,
    // sessions and project cleanup. Never generalize this to production.
    if (holdIds.length > 0)
      await sql`DELETE FROM app.legal_holds WHERE id = ANY(${holdIds})`;
    const retainedRuns = await sql<
      { id: string }[]
    >`SELECT id FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND project_id = ${projectId} AND task_id = ANY(${contexts})`;
    for (const row of retainedRuns) ownedRunIds.add(row.id);
    await sql`DELETE FROM pgboss.job
      WHERE name IN ('task.agent_turn', 'task.agent_retry', 'task.agent_retry_recheck')
        AND (data ->> 'runId' = ANY(${[...ownedRunIds]})
          OR data ->> 'expectedRunId' = ANY(${[...ownedRunIds]})
          OR data ->> 'taskId' = ANY(${contexts}))`;
    await sql`DELETE FROM app.task_review_contexts WHERE org_id = ${orgId} AND task_id = ANY(${contexts})`;
  }
}
