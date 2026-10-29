/** Real PostgreSQL custody of a workflow agent step the provider refused
 * because the model is at capacity (Codex's terminal "Selected model is at
 * capacity. Please try a different model."). The settle the agent host
 * writes is exec-fenced and lands once; the real stepper consumes the stored
 * result and re-kicks through the real kick: one start, held a minute in the
 * protocol queue, counted, on the same conversation and the same account. A
 * run cancelled during the hold, and a held start whose walker lost the run,
 * are refused before any sandbox work; an ordinary failure still burns its
 * account and starts at once. The kicks resolve a fixed serving (no provider
 * walk, no provider call), and the four automation queues are fenced off the
 * harness's workers for the lane, so no fixture turn ever launches. */
import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { automationAgentHost } from '../../core/automations/agent_host.ts';
import { MODEL_CAPACITY_REKICK_DELAY_MS } from '../../core/automations/agent_retry.ts';
import type { AgentCursor } from '../../core/automations/checkpoints.ts';
import { setAutomationAgentHostFactory } from '../../core/automations/stepper.ts';
import type { AgentTurnServing } from '../../core/lib/providers/agent_serving.ts';
import { sessionIdForWorkflowExecution } from '../../core/sandbox/session_naming.ts';
import { toJson } from '../../db/sql.ts';
import { startWorker } from '../../jobs/runner.ts';
import { createTaskList, type TaskHandler } from '../../jobs/task-list.ts';
import { physicalTaskQueue } from '../../jobs/tasks.ts';
import { automationShimHandlers } from './shim.ts';
import { cancelRun } from './store.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const CAPACITY = 'Selected model is at capacity. Please try a different model.';
const NODE = 'triage';
const REQUEST = {
  model: 'gpt-5.1-codex',
  harness: 'codex',
  prompt: 'Triage the inbox.',
};
/** What every kick of the lane resolves to: a subscription serving, so no
 * gateway key, vision model or provider catalog is looked up. */
const SERVING: AgentTurnServing = {
  lane: 'subscription',
  providerSlug: 'openai',
  modelId: 'gpt-5.1-codex',
  apiBaseUrl: 'https://api.openai.com/v1',
  vision: { readable: true },
};
/** The queues a fixture run's step, poll, start and drive ride: no worker
 * of the harness may take one of them while the lane holds them. */
const QUEUES = [
  'automation.step',
  'automation.poll',
  'automation.agent_turn',
  'automation.agent_drive',
] as const;

interface StoredRun {
  status: string;
  claimEpoch: number;
  leaseOwner: string | null;
  agent: AgentCursor | undefined;
}

interface HeldJob {
  name: string;
  state: string;
  startAfterMs: number;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function checkWorkflowModelCapacityRetry(
  sql: Sql,
  boss: PgBoss,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const taskList = createTaskList({ sql });
  const handlerOf = (queue: (typeof QUEUES)[number]): TaskHandler => {
    const handler = taskList[queue];
    if (handler === undefined) throw new Error(`no handler for ${queue}`);
    return handler;
  };
  for (const queue of QUEUES) {
    await boss.offWork(physicalTaskQueue(queue), { wait: true });
  }
  setAutomationAgentHostFactory((hostCtx, organizationId) =>
    automationAgentHost(hostCtx, organizationId, {
      resolveServing: async () => SERVING,
    }),
  );
  const runIds: string[] = [];
  try {
    await checkRows(sql, ctx, record, runIds, {
      step: handlerOf('automation.step'),
      start: handlerOf('automation.agent_turn'),
    });
  } finally {
    setAutomationAgentHostFactory(null);
    try {
      // Never hand a fixture's step or held start to a real worker.
      await sql`
        DELETE FROM pgboss.job
        WHERE name = ANY(${QUEUES.map((queue) => physicalTaskQueue(queue))})
          AND data ->> 'runId' = ANY(${runIds})
      `;
      await sql`
        UPDATE app.sandbox_session_ops SET status = 'cancelled',
          finalized_at_ms = coalesce(finalized_at_ms, ${Date.now()}),
          finished_at_ms = ${Date.now()}
        WHERE session_id = ANY(${runIds.map((runId) =>
          sessionIdForWorkflowExecution(runId),
        )})
          AND status = 'running'
      `;
      await sql.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`
          UPDATE app.automation_runs SET status = 'cancelled',
            finished_at_ms = ${Date.now()}, wake_at_ms = NULL,
            lease_owner = NULL, lease_expires_at_ms = NULL
          WHERE id = ANY(${runIds}) AND status IN ('queued', 'running', 'waiting')
        `;
      });
    } finally {
      for (const queue of QUEUES) {
        await startWorker({
          boss,
          concurrency: 4,
          taskList: { [queue]: handlerOf(queue) },
        });
      }
    }
  }
}

async function checkRows(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
  runIds: string[],
  jobs: { step: TaskHandler; start: TaskHandler },
): Promise<void> {
  const { orgId, userId } = ctx;
  const shim = automationShimHandlers(sql);
  const settle = shim['automations/mutations:recordAgentTurnSettled'];
  const stampLaunch = shim['automations/mutations:stampAgentTurnLaunch'];
  if (settle === undefined || stampLaunch === undefined) {
    throw new Error('no settle or launch handler');
  }
  const name = `itest-wf-capacity-${randomUUID().slice(0, 8)}`;
  await sql`
    INSERT INTO app.automations (
      org_id, name, version, document, created_by, created_at_ms
    ) VALUES (
      ${orgId}, ${name}, 1,
      ${sql.json(
        toJson({
          version: 1,
          name,
          nodes: [{ id: NODE, type: 'agent', ...REQUEST }],
          output: `{{ nodes.${NODE}.output }}`,
        }),
      )},
      ${userId}, ${Date.now()}
    )
  `;

  /** A live run parked on its agent step's turn, which an earlier
   * failure's re-kick started on the broker's `account`. */
  const parkRun = async (account: string) => {
    const runId = randomUUID();
    runIds.push(runId);
    const agent: AgentCursor = {
      execId: `itest-capacity-${randomUUID()}`,
      sessionId: sessionIdForWorkflowExecution(runId),
      deadlineAt: Date.now() + 3_600_000,
      providerSlug: SERVING.providerSlug,
      gatewayModel: SERVING.modelId,
      harness: REQUEST.harness,
      input: REQUEST,
      attempt: 0,
      launchedAt: Date.now() - 60_000,
      brokerTokenHash: account,
      burnedBrokerTokenHashes: ['itest-capacity-burned-before'],
    };
    await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      await tx`
        INSERT INTO app.automation_runs (
          id, org_id, name, version, status, mode, started_by, input,
          checkpoints, claim_epoch, started_at_ms
        ) VALUES (
          ${runId}, ${orgId}, ${name}, 1, 'waiting', 'live',
          ${`user:${userId}`}, ${tx.json({})},
          ${tx.json(
            toJson({
              nodes: {},
              executions: 1,
              cursor: { node: NODE, index: 0, passes: 0, outs: [], agent },
            }),
          )},
          0, ${Date.now() - 120_000}
        )
      `;
    });
    return { runId, execId: agent.execId };
  };
  const settleTurn = async (
    runId: string,
    execId: string,
    result: Record<string, unknown>,
  ): Promise<boolean> => {
    const outcome = await settle({
      organizationId: orgId,
      runId,
      nodeId: NODE,
      execId,
      result,
    });
    return isRecord(outcome) && outcome.recorded === true;
  };
  const step = (runId: string) => jobs.step({ organizationId: orgId, runId });
  const readRun = async (runId: string): Promise<StoredRun | undefined> => {
    const rows = await sql<
      {
        status: string;
        claimEpoch: number;
        leaseOwner: string | null;
        agent: AgentCursor | null;
      }[]
    >`
      SELECT status, claim_epoch AS "claimEpoch", lease_owner AS "leaseOwner",
             checkpoints -> 'cursor' -> 'agent' AS agent
      FROM app.automation_runs WHERE id = ${runId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : { ...row, agent: row.agent ?? undefined };
  };
  const jobsOf = async (queue: string, runId: string): Promise<HeldJob[]> =>
    sql<HeldJob[]>`
      SELECT name, state::text AS state,
             (extract(epoch FROM start_after) * 1000)::float8 AS "startAfterMs",
             data
      FROM pgboss.job
      WHERE name = ${physicalTaskQueue(queue)} AND data ->> 'runId' = ${runId}
      ORDER BY created_on
    `;
  const opOf = async (runId: string, execId: string) =>
    (
      await sql<{ status: string; finalized: boolean; deadlineMs: number }[]>`
        SELECT status, finalized_at_ms IS NOT NULL AS finalized,
               deadline_ms::float8 AS "deadlineMs"
        FROM app.sandbox_session_ops
        WHERE session_id = ${sessionIdForWorkflowExecution(runId)}
          AND exec_id = ${execId}
      `
    )[0];
  const sessionsOf = async (runId: string) =>
    Number(
      (
        await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM app.sandbox_sessions
          WHERE owner_type = 'workflow_run'
            AND split_part(owner_id, ':', 1) = ${runId}
        `
      )[0]?.count ?? '0',
    );
  const capacity = (agentSessionId: string) => ({
    errored: true,
    reason: CAPACITY,
    failureCode: 'model_capacity',
    agentSessionId,
    text: '',
    files: [],
  });

  // ---- the refusal lands once, on the turn the run waits on ----------
  const first = await parkRun('itest-capacity-healthy');
  const stale = await settleTurn(
    first.runId,
    'itest-capacity-stale-exec',
    capacity('itest-capacity-thread'),
  );
  const won = await settleTurn(
    first.runId,
    first.execId,
    capacity('itest-capacity-thread'),
  );
  const duplicate = await settleTurn(
    first.runId,
    first.execId,
    capacity('itest-capacity-thread'),
  );
  const wakes = await jobsOf('automation.step', first.runId);
  const settled = await readRun(first.runId);
  record(
    'workflow model capacity: the refusal is stored once, on the exec the run waits on, and wakes the run once',
    !stale &&
      won &&
      !duplicate &&
      wakes.length === 1 &&
      settled?.agent?.result?.failureCode === 'model_capacity' &&
      settled.agent.result.agentSessionId === 'itest-capacity-thread' &&
      settled.agent.result.apiErrorStatus === undefined,
    `stale=${stale} won=${won} duplicate=${duplicate} wakes=${wakes.length} result=${JSON.stringify(settled?.agent?.result)}`,
  );

  // ---- the real stepper re-kicks: one start, held, same account ------
  const stepAt = Date.now();
  await step(first.runId);
  const stepped = Date.now();
  const kicked = await readRun(first.runId);
  const held = await jobsOf('automation.agent_turn', first.runId);
  const heldStart = held[0];
  const retryExec = kicked?.agent?.execId ?? '';
  const retryOp = await opOf(first.runId, retryExec);
  record(
    'workflow model capacity: the retry is one queued start held a minute on the same conversation and account, counted, under its walker’s claim',
    kicked?.status === 'waiting' &&
      retryExec !== '' &&
      retryExec !== first.execId &&
      kicked.agent?.result === undefined &&
      kicked.agent?.attempt === 1 &&
      JSON.stringify(kicked.agent?.burnedBrokerTokenHashes) ===
        JSON.stringify(['itest-capacity-burned-before']) &&
      kicked.agent?.resumedFrom === 'itest-capacity-thread' &&
      held.length === 1 &&
      heldStart !== undefined &&
      heldStart.state === 'created' &&
      heldStart.startAfterMs >=
        stepAt + MODEL_CAPACITY_REKICK_DELAY_MS - 1_000 &&
      heldStart.startAfterMs <=
        stepped + MODEL_CAPACITY_REKICK_DELAY_MS + 1_000 &&
      heldStart.data.execId === retryExec &&
      JSON.stringify(heldStart.data.excludeBrokerTokenHashes) ===
        JSON.stringify(['itest-capacity-burned-before']) &&
      isRecord(heldStart.data.resume) &&
      heldStart.data.resume.agentSessionId === 'itest-capacity-thread' &&
      heldStart.data.claimEpoch === kicked.claimEpoch &&
      retryOp?.status === 'running' &&
      retryOp.deadlineMs >= heldStart.startAfterMs,
    `run=${kicked?.status} agent=${JSON.stringify({ ...kicked?.agent, input: undefined })} held=${JSON.stringify(held.map((job) => ({ name: job.name, state: job.state, afterStepMs: job.startAfterMs - stepAt, exclude: job.data.excludeBrokerTokenHashes, resume: job.data.resume, claimEpoch: job.data.claimEpoch })))} claimEpoch=${kicked?.claimEpoch} op=${JSON.stringify(retryOp)}`,
  );

  // ---- a duplicate step finds the held retry and kicks nothing -------
  await step(first.runId);
  const restepped = await readRun(first.runId);
  const heldAgain = await jobsOf('automation.agent_turn', first.runId);
  record(
    'workflow model capacity: a duplicate step job parks on the held retry and kicks no second start',
    restepped?.status === 'waiting' &&
      restepped.agent?.execId === retryExec &&
      heldAgain.length === 1,
    `run=${restepped?.status} exec=${restepped?.agent?.execId === retryExec ? 'same' : restepped?.agent?.execId} held=${heldAgain.length}`,
  );

  // ---- the resumed retry refused again: still counted, still kept ----
  // The held start launched on the same account, resuming the conversation,
  // and the model refused it again.
  const relaunched = await stampLaunch({
    organizationId: orgId,
    runId: first.runId,
    nodeId: NODE,
    execId: retryExec,
    launchedAt: Date.now(),
    brokerTokenHash: 'itest-capacity-healthy',
  });
  const resumedWon = await settleTurn(
    first.runId,
    retryExec,
    capacity('itest-capacity-thread'),
  );
  await step(first.runId);
  const resumed = await readRun(first.runId);
  const resumedHeld = (await jobsOf('automation.agent_turn', first.runId)).find(
    (job) => job.data.execId === resumed?.agent?.execId,
  );
  record(
    'workflow model capacity: a resumed retry the model refused again resumes the same conversation on the same account, counting a second attempt',
    isRecord(relaunched) &&
      relaunched.stamped === true &&
      resumedWon &&
      resumed?.agent?.execId !== retryExec &&
      resumed?.agent?.attempt === 2 &&
      resumed.agent.resumedFrom === 'itest-capacity-thread' &&
      JSON.stringify(resumed.agent.burnedBrokerTokenHashes) ===
        JSON.stringify(['itest-capacity-burned-before']) &&
      resumedHeld !== undefined &&
      resumedHeld.startAfterMs >=
        Date.now() + MODEL_CAPACITY_REKICK_DELAY_MS - 10_000,
    `stamped=${JSON.stringify(relaunched)} won=${resumedWon} agent=${JSON.stringify({ ...resumed?.agent, input: undefined })} held=${JSON.stringify(resumedHeld === undefined ? null : { afterNowMs: resumedHeld.startAfterMs - Date.now(), exclude: resumedHeld.data.excludeBrokerTokenHashes })}`,
  );

  // ---- cancelled during the hold: the start is refused, nothing runs --
  const cancelled = await cancelRun(sql, orgId, first.runId, userId);
  if (resumedHeld !== undefined) await jobs.start(resumedHeld.data);
  const afterCancel = await readRun(first.runId);
  const cancelledOp = await opOf(first.runId, resumed?.agent?.execId ?? '');
  record(
    'workflow model capacity: a run cancelled during the hold refuses its held start before any sandbox work',
    cancelled.cancelled &&
      resumedHeld !== undefined &&
      afterCancel?.status === 'cancelled' &&
      afterCancel.agent?.launchedAt === undefined &&
      cancelledOp?.status === 'cancelled' &&
      cancelledOp.finalized &&
      (await sessionsOf(first.runId)) === 0,
    `cancel=${JSON.stringify(cancelled)} run=${afterCancel?.status} launched=${afterCancel?.agent?.launchedAt} op=${JSON.stringify(cancelledOp)} sessions=${await sessionsOf(first.runId)}`,
  );

  // ---- a walker that lost the run before its park: refused -----------
  const lost = await parkRun('itest-capacity-healthy');
  await settleTurn(lost.runId, lost.execId, capacity('itest-capacity-lost'));
  await step(lost.runId);
  const lostHeld = (await jobsOf('automation.agent_turn', lost.runId))[0];
  const lostKick = await readRun(lost.runId);
  // The kicking walker's park never committed: another walker took the
  // run over, and the cursor still holds the settled refusal it consumes.
  const predecessor = {
    node: NODE,
    index: 0,
    passes: 0,
    outs: [],
    agent: {
      execId: lost.execId,
      sessionId: sessionIdForWorkflowExecution(lost.runId),
      deadlineAt: Date.now() + 3_600_000,
      providerSlug: SERVING.providerSlug,
      gatewayModel: SERVING.modelId,
      harness: REQUEST.harness,
      input: REQUEST,
      attempt: 0,
      result: capacity('itest-capacity-lost'),
    },
  };
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`
      UPDATE app.automation_runs SET
        status = 'running',
        checkpoints = ${tx.json(
          toJson({ nodes: {}, executions: 1, cursor: predecessor }),
        )},
        claim_epoch = claim_epoch + 1, lease_epoch = claim_epoch + 1,
        lease_owner = 'itest-capacity-other-walker',
        lease_expires_at_ms = ${Date.now() + 30_000},
        wake_at_ms = ${Date.now() + 30_000}
      WHERE id = ${lost.runId}
    `;
  });
  if (lostHeld !== undefined) await jobs.start(lostHeld.data);
  const afterLost = await readRun(lost.runId);
  const lostOp = await opOf(lost.runId, lostKick?.agent?.execId ?? '');
  record(
    'workflow model capacity: a held start whose walker lost the run is refused before any sandbox work, leaving the run to its new walker',
    lostHeld !== undefined &&
      lostHeld.data.claimEpoch === lostKick?.claimEpoch &&
      lostOp?.status === 'cancelled' &&
      lostOp.finalized &&
      (await sessionsOf(lost.runId)) === 0 &&
      afterLost?.status === 'running' &&
      afterLost.leaseOwner === 'itest-capacity-other-walker' &&
      afterLost.claimEpoch === (lostKick?.claimEpoch ?? 0) + 1 &&
      afterLost.agent?.execId === lost.execId &&
      afterLost.agent.result !== undefined,
    `held=${JSON.stringify(lostHeld === undefined ? null : { claimEpoch: lostHeld.data.claimEpoch })} kickEpoch=${lostKick?.claimEpoch} op=${JSON.stringify(lostOp)} sessions=${await sessionsOf(lost.runId)} run=${JSON.stringify({ status: afterLost?.status, owner: afterLost?.leaseOwner, epoch: afterLost?.claimEpoch, exec: afterLost?.agent?.execId === lost.execId })}`,
  );

  // ---- an ordinary failure still burns its account, at once ----------
  const ordinary = await parkRun('itest-capacity-failed-account');
  await settleTurn(ordinary.runId, ordinary.execId, {
    errored: true,
    reason: 'stream disconnected',
    failureCode: 'harness_error',
    agentSessionId: 'itest-capacity-ordinary',
    text: '',
    files: [],
  });
  const ordinaryAt = Date.now();
  await step(ordinary.runId);
  const ordinaryRun = await readRun(ordinary.runId);
  const ordinaryJobs = await jobsOf('automation.agent_turn', ordinary.runId);
  const burned = [
    'itest-capacity-burned-before',
    'itest-capacity-failed-account',
  ];
  record(
    'workflow model capacity: an ordinary harness failure still burns its account and starts its retry at once',
    ordinaryRun?.agent?.attempt === 1 &&
      JSON.stringify(ordinaryRun.agent.burnedBrokerTokenHashes) ===
        JSON.stringify(burned) &&
      ordinaryJobs.length === 1 &&
      ordinaryJobs[0] !== undefined &&
      JSON.stringify(ordinaryJobs[0].data.excludeBrokerTokenHashes) ===
        JSON.stringify(burned) &&
      ordinaryJobs[0].data.claimEpoch === undefined &&
      ordinaryJobs[0].startAfterMs <= ordinaryAt + 5_000,
    `agent=${JSON.stringify({ ...ordinaryRun?.agent, input: undefined })} jobs=${JSON.stringify(ordinaryJobs.map((job) => ({ afterStepMs: job.startAfterMs - ordinaryAt, exclude: job.data.excludeBrokerTokenHashes, claimEpoch: job.data.claimEpoch })))}`,
  );
}
