/** Native HTTP/session authority and real PostgreSQL proof. The containing
 * review lane owns these fixture rows and holds all queued agent work. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  taskDelegateReviewReceiptSchema,
  type TaskAgentReviewInput,
  type TaskDelegateReviewInput,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import type { ProjectAuthContext } from '../projects/service.ts';
import { reviewAgentTask, type AgentReviewAuthority } from './agent-review.ts';
import { addTaskComment } from './comments.ts';
import type { Fixtures, Recorder } from './delegated-start.integration.ts';
import { delegateAgentTaskReview } from './review-delegation.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { loadTaskOrThrow, setTaskReviewer } from './service.ts';

type Body = Record<string, unknown>;
const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const output = (body: Body): Body => (isRecord(body.output) ? body.output : {});
const refused = (body: Body, code: string) =>
  body.status === 'invalid_args' && String(body.message).startsWith(`${code}:`);

interface Fixture {
  sql: Sql;
  orgId: string;
  projectId: string;
  implementerId: string;
  reviewerId: string;
  reviewerToken: string;
  reviewerAuthority: AgentReviewAuthority;
  auth: ProjectAuthContext;
  fx: Fixtures;
  sessions: Set<string>;
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
  setPolicy: (value: string) => Promise<void>;
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
          () => reject(new Error('Delegation race barrier timed out')),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
/** The barrier observes a real answer, never replacing SQL or returned rows. */
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

export async function checkReviewDelegation(f: Fixture): Promise<void> {
  const { sql, orgId, projectId, fx } = f;
  const report = (name: string, ok: boolean, detail = '') =>
    f.record(`review delegation: ${name}`, ok, detail);
  const grants = ['task_get', 'task_delegate_review'];
  const manager = randomUUID();
  const otherManager = randomUUID();
  const successor = randomUUID();
  const newReviewer = async (id: string) => {
    await fx.insertAgent(id, projectId, 'Delegated independent reviewer');
    await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get', 'task_review'])} WHERE id = ${id}`;
  };
  const newManager = async (id: string) => {
    await fx.insertAgent(id, projectId, 'Review routing manager');
    await sql`UPDATE app.project_agents SET tools = ${sql.array(grants)} WHERE id = ${id}`;
    const roleTask = await fx.insertTask({
      projectId,
      title: 'Review routing role',
      status: 'in_progress',
      agentId: id,
    });
    const issuer = await f.addRun(roleTask, id, 'running');
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${issuer.sessionId}, 'active', 'project_agent', ${id}, 'itest:delegation', ${fx.now}, ${fx.now + 3_600_000})`;
    f.sessions.add(issuer.sessionId);
    return {
      ...issuer,
      token: await f.tokenFor(issuer.sessionId, issuer.execId, grants),
      authority: {
        organizationId: orgId,
        projectId,
        agentId: id,
        sessionId: issuer.sessionId,
        execId: issuer.execId,
      },
    };
  };
  const issuer = await newManager(manager);
  const otherIssuer = await newManager(otherManager);
  await newReviewer(successor);
  const request = async (
    taskId: string,
    reviewerAgentId = successor,
  ): Promise<TaskDelegateReviewInput> => {
    const captured = await getPendingReviewForTask(sql, orgId, taskId);
    if (
      !captured?.runId ||
      !captured.evidenceRevision ||
      captured.reviewer?.kind !== 'agent'
    )
      throw new Error('Delegation fixture has no captured agent source');
    return {
      taskId,
      reviewerAgentId,
      expected: {
        approvalId: captured.approvalId,
        runId: captured.runId,
        evidenceRevision: captured.evidenceRevision,
        reviewer: captured.reviewer,
      },
      reason: 'Route this captured review to another independent worker.',
    };
  };
  const delegate = (input: TaskDelegateReviewInput, token = issuer.token) =>
    f.dispatch(token, input, 'task_delegate_review');
  const unchangedState = async (taskId: string) => ({
    task: await loadTaskOrThrow(sql, taskId, orgId),
    defaults:
      await sql`SELECT default_task_reviewer_agent_id FROM app.projects WHERE id = ${projectId}`,
    runs: await sql`SELECT * FROM app.project_agent_runs WHERE org_id = ${orgId} AND task_id = ${taskId} ORDER BY seq`,
    comments:
      await sql`SELECT m.id, m.text, d.author_type, d.author_id, d.body_by_locale
      FROM app.task_discussion_message_meta d JOIN app.messages m ON m.id = d.message_id AND m.org_id = d.org_id
      WHERE d.org_id = ${orgId} AND d.task_id = ${taskId} ORDER BY m.id`,
    jobs: await sql`SELECT id, state, data FROM pgboss.job WHERE name IN ('task.agent_turn', 'task.agent_retry')
      AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs WHERE task_id = ${taskId}) ORDER BY id`,
  });
  const gates = (taskId: string) =>
    sql<{ id: string; status: string; metadata: Body }[]>`
      SELECT id, status, metadata FROM app.approvals WHERE org_id = ${orgId}
        AND resource_type = 'task_review' AND resource_id = ${taskId} ORDER BY seq
    `;
  const snapshot = async (taskId: string) => ({
    state: await unchangedState(taskId),
    gates: await gates(taskId),
    activity:
      await sql`SELECT * FROM app.task_activity WHERE task_id = ${taskId} ORDER BY id`,
    audit:
      await sql`SELECT * FROM app.audit_logs WHERE org_id = ${orgId} AND resource_id = ${taskId} ORDER BY id`,
    notifications:
      await sql`SELECT * FROM app.user_notifications WHERE org_id = ${orgId} AND task_id = ${taskId} ORDER BY id`,
    realtime:
      await sql`SELECT * FROM app_realtime.outbox WHERE org_id = ${orgId} AND entity = 'task' AND entity_id = ${taskId} ORDER BY id`,
  });
  const noEffect = async (
    input: TaskDelegateReviewInput,
    name: string,
    code: string,
    token = issuer.token,
  ) => {
    const before = await snapshot(input.taskId);
    const result = await delegate(input, token);
    report(
      name,
      refused(result, code) &&
        isDeepStrictEqual(before, await snapshot(input.taskId)),
      String(result.message),
    );
  };

  const happy = await f.submit('Delegate one captured review');
  const input = await request(happy.taskId);
  const originalVerdict = await f.inputFor(happy.taskId);
  const before = await unchangedState(happy.taskId);
  const result = await delegate(input);
  const parsed = taskDelegateReviewReceiptSchema.safeParse(output(result));
  const pending = await getPendingReviewForTask(sql, orgId, happy.taskId);
  const rows = await gates(happy.taskId);
  report(
    'HTTP changes exactly one captured gate and preserves task owner, defaults, status, source, runs and comments',
    result.status === 'ok' &&
      parsed.success &&
      parsed.data.previousApprovalId === input.expected.approvalId &&
      parsed.data.approvalId !== input.expected.approvalId &&
      parsed.data.runId === happy.runId &&
      parsed.data.evidenceRevision === input.expected.evidenceRevision &&
      parsed.data.managerAgentId === manager &&
      parsed.data.issuerRunId === issuer.id &&
      parsed.data.previousReviewer.agentId === f.reviewerId &&
      parsed.data.reviewer.agentId === successor &&
      pending?.approvalId === parsed.data.approvalId &&
      pending.reviewer?.kind === 'agent' &&
      pending.reviewer.agentId === successor &&
      rows.length === 2 &&
      rows[0]?.status === 'rejected' &&
      rows[1]?.status === 'pending' &&
      isDeepStrictEqual(before, await unchangedState(happy.taskId)),
    `status=${String(result.status)} gates=${rows.length}`,
  );
  if (!parsed.success || result.status !== 'ok')
    throw new Error('Native delegation did not admit its control');
  const read = await f.dispatch(
    issuer.token,
    { taskId: happy.taskId, commentLimit: 1, runLimit: 1 },
    'task_get',
  );
  report(
    'task_get returns the durable typed handoff receipt',
    read.status === 'ok' &&
      isDeepStrictEqual(output(read).reviewDelegation, parsed.data) &&
      isDeepStrictEqual(rows[0]?.metadata.delegation, parsed.data),
  );
  const activity = await sql<
    { actorType: string; actorId: string; previous: string; value: string }[]
  >`
    SELECT actor_type AS "actorType", actor_id AS "actorId", from_value AS previous, to_value AS value
    FROM app.task_activity WHERE task_id = ${happy.taskId} AND action = 'review.delegated'
  `;
  report(
    'one durable activity records the authentic manager and typed reviewer handoff',
    activity.length === 1 &&
      activity[0]?.actorType === 'agent' &&
      activity[0].actorId === manager &&
      isDeepStrictEqual(
        JSON.parse(activity[0].previous),
        parsed.data.previousReviewer,
      ) &&
      isDeepStrictEqual(JSON.parse(activity[0].value), parsed.data.reviewer),
  );
  const delegatedState = await snapshot(happy.taskId);
  const replay = await delegate(input);
  report(
    'same live issuer retries without another approval, audit or activity',
    replay.status === 'ok' &&
      isDeepStrictEqual(output(replay), parsed.data) &&
      isDeepStrictEqual(delegatedState, await snapshot(happy.taskId)),
  );
  await noEffect(
    input,
    'another live manager cannot replay the first manager receipt',
    'TASK_REVIEW_STALE',
    otherIssuer.token,
  );
  const staleVerdict = await f.dispatch(f.reviewerToken, originalVerdict);
  report(
    'the former reviewer cannot decide the superseded gate',
    refused(staleVerdict, 'TASK_REVIEW_STALE') &&
      isDeepStrictEqual(delegatedState, await snapshot(happy.taskId)),
    String(staleVerdict.message),
  );

  const revoked = await f.submit('Revoked manager grant');
  const revokedInput = await request(revoked.taskId);
  await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get'])} WHERE id = ${manager}`;
  await noEffect(
    revokedInput,
    'current manager grant gates first admission',
    'TASK_REVIEW_FORBIDDEN',
  );
  await noEffect(
    input,
    'current manager grant gates historical retry',
    'TASK_REVIEW_FORBIDDEN',
  );
  await sql`UPDATE app.project_agents SET tools = ${sql.array(grants)} WHERE id = ${manager}`;
  const noGrantToken = await f.tokenFor(issuer.sessionId, issuer.execId, [
    'task_get',
  ]);
  const beforeNoGrant = await snapshot(revoked.taskId);
  const noGrant = await delegate(revokedInput, noGrantToken);
  report(
    'a token without the explicit delegation grant cannot mutate the gate',
    noGrant.status !== 'ok' &&
      isDeepStrictEqual(beforeNoGrant, await snapshot(revoked.taskId)),
  );
  await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get'])} WHERE id = ${successor}`;
  await noEffect(
    revokedInput,
    'destination needs its current review grant',
    'TASK_REVIEWER_PERMISSION_MISSING',
  );
  await noEffect(
    input,
    'destination grant loss also blocks retry',
    'TASK_REVIEWER_PERMISSION_MISSING',
  );
  await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get', 'task_review'])} WHERE id = ${successor}`;
  for (const [id, code, name] of [
    [manager, 'TASK_REVIEW_FORBIDDEN', 'manager cannot delegate to itself'],
    [
      f.reviewerId,
      'TASK_REVIEW_FORBIDDEN',
      'current recipient is not a handoff',
    ],
    [
      f.implementerId,
      'TASK_REVIEWER_PERMISSION_MISSING',
      'ungranted implementer cannot become reviewer',
    ],
  ]) {
    await noEffect({ ...revokedInput, reviewerAgentId: id }, name, code);
  }
  // The source actor must remain independent even if it has the review tool.
  const implementationTools = await sql<
    { tools: string[] | null }[]
  >`SELECT tools FROM app.project_agents WHERE id = ${f.implementerId}`;
  await sql`UPDATE app.project_agents SET tools = ${sql.array(['task_get', 'task_review'])} WHERE id = ${f.implementerId}`;
  try {
    await noEffect(
      { ...revokedInput, reviewerAgentId: f.implementerId },
      'granted implementer still cannot review its own source',
      'TASK_REVIEWER_NOT_INDEPENDENT',
    );
  } finally {
    await sql`UPDATE app.project_agents SET tools = ${implementationTools[0]?.tools === null ? null : sql.array(implementationTools[0]?.tools ?? [])} WHERE id = ${f.implementerId}`;
  }
  const removedReviewer = randomUUID();
  await newReviewer(removedReviewer);
  const deletedInput = { ...revokedInput, reviewerAgentId: removedReviewer };
  await sql`DELETE FROM app.project_agents WHERE id = ${removedReviewer}`;
  await noEffect(
    deletedInput,
    'deleted destination cannot receive a pending review',
    'TASK_REVIEWER_INVALID',
  );

  const retiredReviewer = randomUUID();
  await newReviewer(retiredReviewer);
  const orphaned = await f.submit(
    'Recover a captured reviewer that was deleted',
  );
  const orphanedOriginal = await request(orphaned.taskId);
  await transactSerializable(sql, (tx) =>
    setTaskReviewer(tx, f.auth, orphaned.taskId, {
      reviewer: { kind: 'agent', agentId: retiredReviewer },
      expected: {
        reviewer: orphanedOriginal.expected.reviewer,
        pendingReview: {
          approvalId: orphanedOriginal.expected.approvalId,
          runId: orphanedOriginal.expected.runId,
          reviewer: orphanedOriginal.expected.reviewer,
        },
      },
    }),
  );
  await sql`DELETE FROM app.project_agents WHERE id = ${retiredReviewer}`;
  const orphanedInput = await request(orphaned.taskId);
  const orphanedBefore = await unchangedState(orphaned.taskId);
  const recovered = await delegate(orphanedInput);
  const recoveredPending = await getPendingReviewForTask(
    sql,
    orgId,
    orphaned.taskId,
  );
  report(
    'a deleted captured recipient can be replaced without guessing or changing future routing',
    orphanedInput.expected.reviewer.agentId === retiredReviewer &&
      recovered.status === 'ok' &&
      recoveredPending?.reviewer?.kind === 'agent' &&
      recoveredPending.reviewer.agentId === successor &&
      isDeepStrictEqual(orphanedBefore, await unchangedState(orphaned.taskId)),
    `status=${String(recovered.status)}`,
  );

  for (const change of [
    'description',
    'result',
    'comment',
    'archive',
    'status',
    'restart',
    'newer_source',
  ] as const) {
    const source = await f.submit(`Delegation stale ${change}`);
    const captured = await request(source.taskId);
    if (change === 'description')
      await sql`UPDATE app.tasks SET description = 'Changed requirement' WHERE id = ${source.taskId}`;
    if (change === 'result')
      await sql`UPDATE app.project_agent_runs SET result_text = 'Changed source result' WHERE id = ${source.runId}`;
    if (change === 'comment')
      await transactSerializable(sql, (tx) =>
        addTaskComment(tx, f.auth, {
          taskId: source.taskId,
          body: 'A new acceptance condition.',
        }),
      );
    if (change === 'archive')
      await sql`UPDATE app.tasks SET archived_at_ms = ${Date.now()} WHERE id = ${source.taskId}`;
    if (change === 'status')
      await sql`UPDATE app.tasks SET status = 'todo' WHERE id = ${source.taskId}`;
    const restarted =
      change === 'restart'
        ? await f.addRun(source.taskId, f.implementerId, 'running')
        : undefined;
    if (change === 'newer_source')
      await f.addRun(source.taskId, f.implementerId);
    await noEffect(
      captured,
      `${change} invalidates captured delegation without effects`,
      change === 'archive'
        ? 'TASK_ARCHIVED'
        : change === 'restart'
          ? 'TASK_REVIEW_BUSY'
          : change === 'newer_source'
            ? 'TASK_REVIEW_SOURCE_CHANGED'
            : 'TASK_REVIEW_STALE',
    );
    if (restarted !== undefined)
      await sql`UPDATE app.project_agent_runs SET status = 'cancelled', settled_at_ms = ${Date.now()} WHERE id = ${restarted.id}`;
  }
  await sql`UPDATE app.tasks SET description = 'Changed after a successful handoff' WHERE id = ${happy.taskId}`;
  await noEffect(
    input,
    'evidence edits also invalidate a formerly successful retry',
    'TASK_REVIEW_STALE',
  );
  await f.setPolicy('requiredCompetences: [release]\n');
  try {
    await noEffect(
      revokedInput,
      'human competence policy is not bypassed by routing',
      'TASK_REVIEWER_HUMAN_REQUIRED',
    );
  } finally {
    await f.setPolicy('{}\n');
  }

  const competing = await f.submit('Two concurrent routing managers');
  const competingInput = await request(competing.taskId);
  const answers = await Promise.all([
    delegate(competingInput),
    delegate(competingInput, otherIssuer.token),
  ]);
  const competingGates = await gates(competing.taskId);
  report(
    'two managers elect one successor and the loser cannot borrow its receipt',
    answers.filter((answer) => answer.status === 'ok').length === 1 &&
      answers.filter((answer) => refused(answer, 'TASK_REVIEW_STALE'))
        .length === 1 &&
      competingGates.length === 2 &&
      competingGates.filter((gate) => gate.status === 'pending').length === 1,
    JSON.stringify(answers.map((answer) => answer.status)),
  );
  const duplicate = await f.submit('Concurrent retry from one manager');
  const duplicateInput = await request(duplicate.taskId);
  const retries = await Promise.all([
    delegate(duplicateInput),
    delegate(duplicateInput),
  ]);
  report(
    'concurrent identical retries return one durable successor',
    retries.every((answer) => answer.status === 'ok') &&
      isDeepStrictEqual(output(retries[0] ?? {}), output(retries[1] ?? {})) &&
      (await gates(duplicate.taskId)).length === 2,
  );

  for (const verdictFirst of [true, false]) {
    const source = await f.submit(
      `Delegation race ${verdictFirst ? 'verdict' : 'handoff'} first`,
    );
    const captured = await request(source.taskId);
    const verdictInput = await f.inputFor(source.taskId);
    const handoff = (tx: TransactionSql) =>
      delegateAgentTaskReview(tx, issuer.authority, captured);
    const verdict = (tx: TransactionSql) =>
      reviewAgentTask(tx, f.reviewerAuthority, verdictInput);
    const ready = latch();
    const releaseFirst = latch();
    const seen = latch();
    // Attach rejection handling immediately: a failure before the readiness
    // signal must remain an observed failure, never an unhandled rejection.
    const first = transactSerializable(sql, async (tx) => {
      await (verdictFirst ? verdict(tx) : handoff(tx));
      ready.release();
      await bounded(releaseFirst.ready);
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let second: Promise<string | null> | undefined;
    let outcomes:
      | [Awaited<typeof first>, string | null | undefined]
      | undefined;
    let barrierFailed = false;
    let barrierError: unknown;
    try {
      await bounded(
        Promise.race([
          ready.ready,
          first.then((settledFirst) => {
            if (!settledFirst.ok) throw settledFirst.error;
          }),
        ]),
      );
      second = refusal(() =>
        transactSerializable(sql, async (tx) => {
          await (verdictFirst
            ? handoff(observeTaskRead(tx, seen.release))
            : verdict(observeTaskRead(tx, seen.release)));
        }),
      );
      await bounded(
        Promise.race([
          seen.ready,
          first.then((settledFirst) => {
            if (!settledFirst.ok) throw settledFirst.error;
          }),
          second.then((code) => {
            if (code !== null)
              throw new Error(
                `Delegation race contender failed before observation: ${code}`,
              );
          }),
        ]),
      );
    } catch (error) {
      barrierFailed = true;
      barrierError = error;
    } finally {
      releaseFirst.release();
      // Both transactions belong to this fixture. Settle them before the
      // enclosing lane tears down its rows, including a failed barrier path.
      try {
        outcomes = await bounded(Promise.all([first, second]));
      } catch (error) {
        if (!barrierFailed) {
          barrierFailed = true;
          barrierError = error;
        }
      }
    }
    if (barrierFailed) throw barrierError;
    if (outcomes === undefined)
      throw new Error('Delegation race did not settle');
    if (!outcomes[0].ok) throw outcomes[0].error;
    const final = await loadTaskOrThrow(sql, source.taskId, orgId);
    const finalGates = await gates(source.taskId);
    report(
      `serializable ${verdictFirst ? 'verdict before handoff' : 'handoff before verdict'} has one authoritative winner`,
      outcomes[1] === 'TASK_REVIEW_STALE' &&
        final.status === (verdictFirst ? 'done' : 'in_review') &&
        final.assigneeId === f.implementerId &&
        final.reviewerAgentId === f.reviewerId &&
        finalGates.length === (verdictFirst ? 1 : 2) &&
        finalGates.filter((gate) => gate.status === 'pending').length ===
          (verdictFirst ? 0 : 1),
      `loser=${String(outcomes[1])} status=${final.status}`,
    );
  }
  const rollback = await f.submit('Rollback captured review delegation');
  const rollbackInput = await request(rollback.taskId);
  const rollbackBefore = await snapshot(rollback.taskId);
  const rolledBack = await refusal(() =>
    transactSerializable(sql, async (tx) => {
      await delegateAgentTaskReview(tx, issuer.authority, rollbackInput);
      throw new Error('itest: rollback after native delegation');
    }),
  );
  report(
    'transaction rollback retains original gate and removes all handoff effects',
    rolledBack !== null &&
      isDeepStrictEqual(rollbackBefore, await snapshot(rollback.taskId)),
  );
  const successorRole = await fx.insertTask({
    projectId,
    title: 'Delegated review role',
    status: 'in_progress',
    agentId: successor,
  });
  const successorIssuer = await f.addRun(successorRole, successor, 'running');
  await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
    VALUES (${orgId}, ${successorIssuer.sessionId}, 'active', 'project_agent', ${successor}, 'itest:delegation', ${fx.now}, ${fx.now + 3_600_000})`;
  f.sessions.add(successorIssuer.sessionId);
  const successorToken = await f.tokenFor(
    successorIssuer.sessionId,
    successorIssuer.execId,
  );
  const toComplete = await f.submit(
    'Delegate then complete the exact reviewed source',
  );
  const completeRequest = await request(toComplete.taskId);
  const handoff = await delegate(completeRequest);
  if (handoff.status !== 'ok')
    throw new Error('Delegated verdict control lost its handoff');
  const completed = await f.dispatch(
    successorToken,
    await f.inputFor(toComplete.taskId),
  );
  const completedTask = await loadTaskOrThrow(sql, toComplete.taskId, orgId);
  report(
    'the delegated reviewer can issue the native verdict without changing implementation ownership or future reviewer',
    completed.status === 'ok' &&
      completedTask.status === 'done' &&
      completedTask.assigneeId === f.implementerId &&
      completedTask.reviewerAgentId === f.reviewerId &&
      (await gates(toComplete.taskId)).filter(
        (gate) => gate.status === 'pending',
      ).length === 0,
    `status=${String(completed.status)}`,
  );
  await noEffect(
    completeRequest,
    'a decided successor is no longer a replayable handoff',
    'TASK_REVIEW_STALE',
  );
  await sql`UPDATE app.project_agent_runs SET status = 'cancelled', settled_at_ms = ${Date.now()} WHERE id = ${issuer.id}`;
  const endedBefore = await snapshot(duplicate.taskId);
  const ended = await delegate(duplicateInput);
  report(
    'ended issuer cannot reuse its retained token for a successful handoff receipt',
    ended.status !== 'ok' &&
      isDeepStrictEqual(endedBefore, await snapshot(duplicate.taskId)),
  );
}
