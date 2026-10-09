/** Actual HTTP/token admission over real PostgreSQL. The containing review
 * lane owns all fixture rows and holds every queued agent job. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  taskAgentRepairReceiptSchema,
  type TaskAgentReviewInput,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import type { ProjectAuthContext } from '../projects/service.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import {
  runsOf,
  type Fixtures,
  type Recorder,
} from './delegated-start.integration.ts';
import { startDelegatedAgentRun } from './delegated-start.ts';
import { getPendingReviewForTask, requestTaskReview } from './reviews.ts';
import { assignTask, loadTaskOrThrow, updateTaskStatus } from './service.ts';

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
  editorId: string;
  auth: ProjectAuthContext;
  fx: Fixtures;
  sessions: Set<string>;
  reviewerToken: string;
  record: Recorder;
  submit: (title: string) => Promise<{ taskId: string; runId: string }>;
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
          () => reject(new Error('Repair race barrier timed out')),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
/** Observe an actual answer, without replacing any SQL or returned data. */
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

export async function checkReviewRepair(f: Fixture): Promise<void> {
  const { sql, orgId, projectId, fx, record } = f;
  const report = (name: string, ok: boolean, detail = '') =>
    record(`review repair: ${name}`, ok, detail);
  const manager = randomUUID();
  const otherManager = randomUUID();
  const grants = ['task_get', 'task_start_agent'];
  const newManager = async (id: string) => {
    await fx.insertAgent(id, projectId, 'Repair manager');
    await sql`UPDATE app.project_agents SET tools = ${sql.array(grants)} WHERE id = ${id}`;
    const roleTask = await fx.insertTask({
      projectId,
      title: 'Repair manager role',
      status: 'in_progress',
      agentId: id,
    });
    const issuer = await f.addRun(roleTask, id, 'running');
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${issuer.sessionId}, 'active', 'project_agent', ${id}, 'itest:repair', ${fx.now}, ${fx.now + 3_600_000})`;
    f.sessions.add(issuer.sessionId);
    return {
      ...issuer,
      roleTask,
      token: await f.tokenFor(issuer.sessionId, issuer.execId, grants),
    };
  };
  const issuer = await newManager(manager);
  const otherIssuer = await newManager(otherManager);
  const reject = async (title: string) => {
    const source = await f.submit(title);
    const input = {
      ...(await f.inputFor(source.taskId)),
      decision: 'request_changes' as const,
      feedback:
        'The counterexample still fails. Preserve its exact acceptance assertion.',
    };
    const verdict = await f.dispatch(f.reviewerToken, input);
    if (verdict.status !== 'ok')
      throw new Error(
        `Repair fixture rejection failed: ${JSON.stringify(verdict)}`,
      );
    return {
      ...source,
      approvalId: input.expected.approvalId,
      decision: output(verdict),
    };
  };
  const request = (source: {
    taskId: string;
    runId: string;
    approvalId: string;
  }) => ({
    taskId: source.taskId,
    resumeFrom: {
      kind: 'review_repair' as const,
      approvalId: source.approvalId,
      runId: source.runId,
    },
  });
  const start = (source: Parameters<typeof request>[0], token = issuer.token) =>
    f.dispatch(token, request(source), 'task_start_agent');
  const snapshot = async (taskId: string) => ({
    task: await loadTaskOrThrow(sql, taskId, orgId),
    runs: await runsOf(sql, taskId),
    approvals:
      await sql`SELECT * FROM app.approvals WHERE org_id = ${orgId} AND resource_type = 'task_review' AND resource_id = ${taskId} ORDER BY seq`,
    activity:
      await sql`SELECT * FROM app.task_activity WHERE task_id = ${taskId} ORDER BY id`,
    jobs: await sql`SELECT id, state, data FROM pgboss.job WHERE name IN ('task.agent_turn', 'task.agent_retry') AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs WHERE task_id = ${taskId}) ORDER BY id`,
  });
  const stale = async (
    source: Parameters<typeof request>[0],
    cause: string,
  ) => {
    const before = await snapshot(source.taskId);
    const result = await start(source);
    report(
      cause,
      result.status === 'ok' &&
        output(result).reason === 'stale_repair' &&
        isDeepStrictEqual(before, await snapshot(source.taskId)),
      JSON.stringify(result),
    );
  };
  const finish = async (taskId: string, runId: string) => {
    // Real completion needs a launched exec identity, but does not launch a provider.
    const execId = `repair-${randomUUID()}`;
    await sql`UPDATE app.project_agent_runs SET exec_id = ${execId}, status = 'running' WHERE id = ${runId}`;
    return transactSerializable(sql, (tx) =>
      completeAgentRunInTx(tx, {
        organizationId: orgId,
        taskId,
        agentId: f.implementerId,
        runId,
        execId,
        resultText: 'Corrected the counterexample',
        body: 'Local repair result with the assertion retained.',
        files: [],
      }),
    );
  };
  const happy = await reject('Repair one rejected implementation');
  const read = await f.dispatch(
    issuer.token,
    { taskId: happy.taskId },
    'task_get',
  );
  report(
    'later authorized manager reads the stored native decision',
    read.status === 'ok' &&
      isDeepStrictEqual(output(read).reviewDecision, happy.decision),
  );
  const admitted = await start(happy);
  const receipt = taskAgentRepairReceiptSchema.safeParse(
    output(admitted).repairReceipt,
  );
  const initialRuns = await runsOf(sql, happy.taskId);
  const repairRun = initialRuns.find((r) => r.id === output(admitted).runId);
  report(
    'HTTP admission derives implementation and reviewer feedback and stores exact provenance',
    admitted.status === 'ok' &&
      output(admitted).started === true &&
      receipt.success &&
      receipt.data.sourceRunId === happy.runId &&
      receipt.data.approvalId === happy.approvalId &&
      receipt.data.managerAgentId === manager &&
      receipt.data.issuerRunId === issuer.id &&
      receipt.data.feedbackCommentId === happy.decision.feedbackCommentId &&
      repairRun?.agentId === f.implementerId &&
      repairRun.viaRunId === issuer.id &&
      repairRun.feedback?.includes(
        'Preserve its exact acceptance assertion.',
      ) === true &&
      initialRuns.length === 2,
    JSON.stringify(admitted),
  );
  if (repairRun === undefined || !receipt.success)
    throw new Error('Guarded repair did not admit its control');
  const admittedState = await snapshot(happy.taskId);
  const replay = await start(happy);
  report(
    'ambiguous response retry has one run and queue effect',
    output(replay).replayed === true &&
      output(replay).runId === repairRun.id &&
      isDeepStrictEqual(admittedState, await snapshot(happy.taskId)),
    JSON.stringify(replay),
  );
  const wrongAgentReplay = await f.dispatch(
    issuer.token,
    { ...request(happy), agentId: otherManager },
    'task_start_agent',
  );
  report(
    'an explicit contradictory implementer refuses even on historical replay',
    output(wrongAgentReplay).reason === 'stale_repair' &&
      output(wrongAgentReplay).staleBecause === 'assignee_changed' &&
      isDeepStrictEqual(admittedState, await snapshot(happy.taskId)),
    JSON.stringify(wrongAgentReplay),
  );
  const denied = await start(happy, otherIssuer.token);
  report(
    'another manager cannot claim the admission receipt',
    denied.status === 'invalid_args' &&
      String(denied.message).startsWith('AGENT_START_FORBIDDEN:') &&
      isDeepStrictEqual(admittedState, await snapshot(happy.taskId)),
    JSON.stringify(denied),
  );
  await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get'])} WHERE id = ${manager}`;
  const revokedReplay = await start(happy);
  report(
    'a retained token cannot replay after the current delegation grant is revoked',
    revokedReplay.status === 'invalid_args' &&
      String(revokedReplay.message).startsWith('AGENT_START_FORBIDDEN:') &&
      isDeepStrictEqual(admittedState, await snapshot(happy.taskId)),
    JSON.stringify(revokedReplay),
  );
  await sql`UPDATE app.project_agents SET tools = ${sql.array(grants)} WHERE id = ${manager}`;
  const completed = await finish(happy.taskId, repairRun.id);
  const pending = await getPendingReviewForTask(sql, orgId, happy.taskId);
  const pendingRead = await f.dispatch(
    issuer.token,
    { taskId: happy.taskId },
    'task_get',
  );
  report(
    'ordinary repair completion creates the next review and hides the older decision',
    completed &&
      pending?.runId === repairRun.id &&
      pending.approvalId !== happy.approvalId &&
      output(pendingRead).reviewDecision === null &&
      (await loadTaskOrThrow(sql, happy.taskId, orgId)).status === 'in_review',
  );
  const afterComplete = await snapshot(happy.taskId);
  const terminalReplay = await start(happy);
  report(
    'terminal repair replay preserves the new pending review and current task state',
    output(terminalReplay).runId === repairRun.id &&
      output(terminalReplay).replayed === true &&
      isDeepStrictEqual(afterComplete, await snapshot(happy.taskId)),
  );
  const approved = await f.dispatch(
    f.reviewerToken,
    await f.inputFor(happy.taskId),
  );
  const approvedRead = await f.dispatch(
    otherIssuer.token,
    { taskId: happy.taskId },
    'task_get',
  );
  report(
    'another current reader reconciles a committed approval from its native receipt',
    approved.status === 'ok' &&
      isDeepStrictEqual(output(approvedRead).reviewDecision, output(approved)),
  );
  await sql`UPDATE app.project_agent_runs SET status = 'settled', settled_at_ms = ${Date.now()} WHERE id = ${issuer.id}`;
  const laterIssuer = await f.addRun(issuer.roleTask, manager, 'running');
  const laterToken = await f.tokenFor(
    laterIssuer.sessionId,
    laterIssuer.execId,
    grants,
  );
  const beforeLater = await snapshot(happy.taskId);
  const laterReplay = await start(happy, laterToken);
  report(
    'a later live run of the same manager replays without rewriting the original issuer or Done',
    output(laterReplay).replayed === true &&
      isDeepStrictEqual(output(laterReplay).repairReceipt, receipt.data) &&
      isDeepStrictEqual(beforeLater, await snapshot(happy.taskId)),
  );
  const oldIssuer = await start(happy);
  report(
    'an ended issuer cannot use its retained token',
    oldIssuer.status === 'unavailable' &&
      isDeepStrictEqual(beforeLater, await snapshot(happy.taskId)),
    JSON.stringify(oldIssuer),
  );
  // Model retention of this attempt's disposable source row only. Never
  // remint work from a claim whose original source no longer exists.
  await sql`DELETE FROM app.project_agent_runs WHERE id = ${happy.runId} AND org_id = ${orgId}`;
  const retainedState = await snapshot(happy.taskId);
  const missingSource = await start(happy, laterToken);
  report(
    'retention of the source refuses replay without reminting its admitted repair',
    output(missingSource).reason === 'stale_repair' &&
      output(missingSource).staleBecause === 'source_unavailable' &&
      isDeepStrictEqual(retainedState, await snapshot(happy.taskId)),
    JSON.stringify(missingSource),
  );
  // Continue with the live occurrence; the immutable receipt above keeps its original issuer.
  issuer.token = laterToken;
  issuer.id = laterIssuer.id;
  issuer.execId = laterIssuer.execId;

  for (const status of ['done', 'cancelled'] as const) {
    const source = await reject(`Human ${status} wins`);
    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, f.auth, source.taskId, status),
    );
    await stale(source, `human ${status} after discovery cannot be reopened`);
    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, f.auth, source.taskId, 'todo'),
    );
    await stale(
      source,
      `human ${status} then To do is still an intervening decision`,
    );
  }
  const reassigned = await reject('Assignee changed away and back');
  await transactSerializable(sql, (tx) =>
    assignTask(tx, f.auth, {
      taskId: reassigned.taskId,
      assigneeType: 'agent',
      assigneeId: otherManager,
    }),
  );
  await stale(reassigned, 'changed assignee is not silently replaced');
  await transactSerializable(sql, (tx) =>
    assignTask(tx, f.auth, {
      taskId: reassigned.taskId,
      assigneeType: 'agent',
      assigneeId: f.implementerId,
    }),
  );
  await stale(
    reassigned,
    'assignee away then back is still an intervening decision',
  );
  const newer = await reject('Newer source supersedes repair');
  await f.addRun(newer.taskId, f.implementerId);
  await stale(newer, 'a newer implementation invalidates the rejected source');
  const inPlace = await reject('Standing occurrence is not repairable');
  await sql`UPDATE app.project_agent_runs SET in_place = true, trigger = 'delegated', started_via = 'agent', started_via_run_id = ${issuer.id}, started_via_agent_id = ${manager} WHERE id = ${inPlace.runId}`;
  await stale(inPlace, 'an in-place source cannot enter the repair lifecycle');
  const humanReview = await reject(
    'A newer human review replaces native history',
  );
  await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, f.auth, humanReview.taskId, 'in_review'),
  );
  const humanRead = await f.dispatch(
    issuer.token,
    { taskId: humanReview.taskId },
    'task_get',
  );
  report(
    'newer human pending review hides the former native decision',
    output(humanRead).reviewDecision === null,
  );
  await stale(humanReview, 'a newer pending review prevents repair admission');
  await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, f.auth, humanReview.taskId, 'done'),
  );
  const humanDoneRead = await f.dispatch(
    issuer.token,
    { taskId: humanReview.taskId },
    'task_get',
  );
  report(
    'a newer human decision hides the former native receipt',
    output(humanDoneRead).reviewDecision === null,
  );
  const malformed = await reject('Corrupt receipt cannot start');
  await sql`UPDATE app.approvals SET metadata = metadata || '{"repairDispatch": {"runId": "lost"}}'::jsonb WHERE id = ${malformed.approvalId}`;
  await stale(
    malformed,
    'a malformed prior claim never becomes an unclaimed approval',
  );
  const badDecision = await reject('Corrupt native decision cannot start');
  await sql`UPDATE app.approvals SET metadata = metadata || '{"response": {"decision": "request_changes"}}'::jsonb WHERE id = ${badDecision.approvalId}`;
  await stale(badDecision, 'an incomplete native receipt is not authority');
  const badRead = await f.dispatch(
    issuer.token,
    { taskId: badDecision.taskId },
    'task_get',
  );
  report(
    'malformed latest decision is unavailable rather than invented',
    output(badRead).reviewDecision === null,
  );
  const swapped = await reject('Wrong task approval cannot start');
  await stale(
    { ...swapped, approvalId: happy.approvalId },
    'another task approval cannot authorize a repair',
  );
  const freshRevoked = await reject('Revoked grant blocks new admission');
  await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get'])} WHERE id = ${manager}`;
  const beforeRevoked = await snapshot(freshRevoked.taskId);
  const revoked = await start(freshRevoked);
  report(
    'current grant also gates first admission',
    revoked.status === 'invalid_args' &&
      String(revoked.message).startsWith('AGENT_START_FORBIDDEN:') &&
      isDeepStrictEqual(beforeRevoked, await snapshot(freshRevoked.taskId)),
    JSON.stringify(revoked),
  );
  await sql`UPDATE app.project_agents SET tools = ${sql.array(grants)} WHERE id = ${manager}`;

  const blocked = await reject('Dependency prevents repair');
  const blocker = await fx.insertTask({
    projectId,
    title: 'Open repair dependency',
  });
  await fx.block(blocked.taskId, blocker, projectId);
  const blockedBefore = await snapshot(blocked.taskId);
  const blockedResult = await start(blocked);
  report(
    'dependency refusal writes no repair claim or run',
    output(blockedResult).reason === 'blocked' &&
      isDeepStrictEqual(blockedBefore, await snapshot(blocked.taskId)),
    JSON.stringify(blockedResult),
  );
  // An implementer at work on another task is started all the same: the
  // repair run works in a worker of its own, or waits for one.
  const busy = await reject('Busy implementation workspace');
  const busyTask = await fx.insertTask({
    projectId,
    title: 'Existing implementation work',
    agentId: f.implementerId,
  });
  const occupied = await f.addRun(busyTask, f.implementerId, 'running');
  const busyRunsBefore = await runsOf(sql, busy.taskId);
  const busyResult = await start(busy);
  const busyRunsAfter = await runsOf(sql, busy.taskId);
  const busyRepairRun = busyRunsAfter.at(-1);
  report(
    'a guarded repair starts an implementer busy on another task, in a run of its own',
    output(busyResult).started === true &&
      typeof output(busyResult).runId === 'string' &&
      busyRunsAfter.length === busyRunsBefore.length + 1 &&
      busyRepairRun?.id === output(busyResult).runId,
    JSON.stringify(busyResult),
  );
  await sql`UPDATE app.project_agent_runs SET status = 'settled', settled_at_ms = ${Date.now()} WHERE id IN (${occupied.id}, ${busyRepairRun?.id ?? occupied.id}) AND status IN ('queued', 'running')`;

  const pausedTask = await fx.insertTask({
    projectId,
    title: 'Hourly repair circuit',
    status: 'in_review',
    agentId: f.implementerId,
  });
  for (let n = 0; n < 3; n += 1) {
    const prior = await f.addRun(pausedTask, f.implementerId);
    await sql`UPDATE app.project_agent_runs SET trigger = 'delegated', started_via = 'agent', started_via_run_id = ${issuer.id}, started_via_agent_id = ${manager} WHERE id = ${prior.id}`;
  }
  const pausedSource = await f.addRun(pausedTask, f.implementerId);
  const nativeReviewer = happy.decision.reviewer;
  if (!isRecord(nativeReviewer) || typeof nativeReviewer.agentId !== 'string')
    throw new Error('Fixture has no native reviewer');
  await sql`UPDATE app.tasks SET reviewer_agent_id = ${nativeReviewer.agentId} WHERE id = ${pausedTask}`;
  await transactSerializable(sql, async (tx) =>
    requestTaskReview(tx, {
      task: await loadTaskOrThrow(tx, pausedTask, orgId),
      trigger: { kind: 'agent_run', runId: pausedSource.id },
    }),
  );
  const pausedInput = {
    ...(await f.inputFor(pausedTask)),
    decision: 'request_changes' as const,
  };
  await f.dispatch(f.reviewerToken, pausedInput);
  const paused = {
    taskId: pausedTask,
    runId: pausedSource.id,
    approvalId: pausedInput.expected.approvalId,
  };
  const pauseResult = await start(paused);
  const pausedRows = await sql<
    { metadata: Body }[]
  >`SELECT metadata FROM app.approvals WHERE id = ${paused.approvalId}`;
  report(
    'three automated starts still pause repair without consuming its claim',
    output(pauseResult).reason === 'paused' &&
      (await runsOf(sql, pausedTask)).length === 4 &&
      pausedRows[0]?.metadata.repairDispatch === undefined &&
      (await loadTaskOrThrow(sql, pausedTask, orgId)).status === 'todo',
    JSON.stringify(pauseResult),
  );

  const concurrent = await reject('Two simultaneous repair requests');
  const answers = await Promise.all([start(concurrent), start(concurrent)]);
  const concurrentRuns = await runsOf(sql, concurrent.taskId);
  const runId = output(answers[0] ?? {}).runId;
  report(
    'two concurrent HTTP admissions elect exactly one durable repair',
    answers.every(
      (a) =>
        a.status === 'ok' &&
        output(a).started === true &&
        output(a).runId === runId,
    ) &&
      answers.filter((a) => output(a).replayed === true).length === 1 &&
      concurrentRuns.length === 2,
    JSON.stringify(answers),
  );
  if (typeof runId !== 'string')
    throw new Error('Concurrent repair control did not admit');
  await finish(concurrent.taskId, runId);

  const rollback = await reject('Receipt persistence failure rolls back');
  const rollbackBefore = await snapshot(rollback.taskId);
  let injected = false;
  let rollbackCaught = false;
  const domainArgs = (source: Parameters<typeof request>[0]) => ({
    organizationId: orgId,
    scopeProjectIds: [projectId],
    taskId: source.taskId,
    startedBy: f.editorId,
    via: { kind: 'agent' as const, agentId: manager, runId: issuer.id },
    resumeFrom: request(source).resumeFrom,
  });
  try {
    await transactSerializable(sql, (tx) =>
      startDelegatedAgentRun(
        new Proxy(tx, {
          apply(target, thisArg, args: unknown[]) {
            const parts = args[0];
            if (
              Array.isArray(parts) &&
              'raw' in parts &&
              parts
                .join('?')
                .includes('UPDATE app.approvals SET metadata = coalesce')
            ) {
              injected = true;
              throw new Error('injected repair receipt persistence failure');
            }
            return Reflect.apply(target, thisArg, args);
          },
        }),
        domainArgs(rollback),
      ),
    );
  } catch (error) {
    rollbackCaught =
      error instanceof Error &&
      error.message === 'injected repair receipt persistence failure';
  }
  report(
    'post-kick receipt failure rolls back the run, queue and status together',
    injected &&
      rollbackCaught &&
      isDeepStrictEqual(rollbackBefore, await snapshot(rollback.taskId)),
  );

  const racing = await reject('Human decision holds row before repair');
  const locked = latch();
  const release = latch();
  const seen = latch();
  const human = transactSerializable(sql, async (tx) => {
    await updateTaskStatus(tx, f.auth, racing.taskId, 'cancelled');
    locked.release();
    await bounded(release.ready);
  });
  let contender: Promise<unknown> | undefined;
  try {
    await bounded(locked.ready);
    contender = transactSerializable(sql, (tx) =>
      startDelegatedAgentRun(
        observeTaskRead(tx, seen.release),
        domainArgs(racing),
      ),
    );
    await bounded(seen.ready);
  } finally {
    release.release();
  }
  const raceAnswers = await bounded(Promise.all([human, contender]));
  const final = await loadTaskOrThrow(sql, racing.taskId, orgId);
  report(
    'a real task-lock race preserves the intervening human decision',
    isRecord(raceAnswers[1]) &&
      raceAnswers[1].outcome === 'stale_repair' &&
      final.status === 'cancelled' &&
      (await runsOf(sql, racing.taskId)).length === 1,
    JSON.stringify(raceAnswers[1]),
  );
  await sql`UPDATE app.project_agent_runs SET status = 'settled', settled_at_ms = ${Date.now()} WHERE id IN ${sql([issuer.id, otherIssuer.id])}`;
}
