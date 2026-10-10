/** Actual pg-boss mixed-worker proof. Run before the harness starts its
 * ordinary workers: enqueue's singleton is temporarily pointed at these
 * owned queues and restored before return. Both worker sets use real queue
 * names in one exclusively created schema; no transport/name rewrite.
 * Every connection has an 8 s statement bound. Each poll loop admits
 * predicates for 20 s; already-admitted SQL still settles within its own bounds. Both
 * pg-boss instances must settle before the owned schema is removed. */
import { randomUUID } from 'node:crypto';

import { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { createSql } from '../db/sql.ts';
import { resolvePostgresConnection } from '../db/ssl.ts';
import { countAutomationWork } from '../domains/control/service.ts';
import { driveJobPending } from '../domains/sandbox/recovery.ts';
import { ensureQueues } from './boss.ts';
import { addJobInTx, bossDbInTx, setEnqueueBoss } from './enqueue.ts';
import { startWorker } from './runner.ts';
import { physicalTaskQueue, TASK_QUEUE_OPTIONS } from './tasks.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;
const QUEUES = [
  'automation.step',
  'automation.poll',
  'automation.agent_turn',
  'automation.agent_drive',
  'automation.ask_resume',
] as const;

async function waitFor(predicate: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function checkAutomationProtocolQueues(
  databaseUrl: string,
  originalBoss: PgBoss,
  record: Recorder,
): Promise<void> {
  const connection = new URL(databaseUrl);
  connection.searchParams.set(
    'options',
    `${connection.searchParams.get('options') ?? ''} -c statement_timeout=8000 -c lock_timeout=8000`,
  );
  const sql = createSql(connection.toString());
  const schema = `itest_protocol_${randomUUID().replaceAll('-', '')}`;
  const { url, ssl } = resolvePostgresConnection(connection.toString());
  const options = {
    connectionString: url,
    ssl,
    schema,
    max: 2,
    supervise: false,
    schedule: false,
    connectionTimeoutMillis: 8000,
  };
  const current = new PgBoss(options);
  const legacy = new PgBoss(options);
  const errors: string[] = [];
  current.on('error', (error) => errors.push(error.message));
  legacy.on('error', (error) => errors.push(error.message));
  const oldSeen: string[] = [];
  const newSeen: string[] = [];
  const jobs = new Map<string, string>();
  let owned = false;
  let failure: unknown;
  try {
    // No IF NOT EXISTS: an unexpected existing schema is not ours to delete.
    await sql`CREATE SCHEMA ${sql(schema)}`;
    owned = true;
    await current.start();
    await legacy.start();
    await ensureQueues(current);
    setEnqueueBoss(current);
    for (const name of QUEUES) {
      const physical = physicalTaskQueue(name);
      const configured = await current.getQueue(physical);
      record(
        `automation queue: ${name} is protocol-isolated with unchanged delivery options`,
        physical === `automation.v2.${name.slice('automation.'.length)}` &&
          (await current.getQueue(name)) === null &&
          Object.entries(TASK_QUEUE_OPTIONS[name]).every(
            ([key, value]) =>
              configured !== null && Reflect.get(configured, key) === value,
          ),
        `physical=${physical}, configured=${configured !== null}`,
      );
      await legacy.createQueue(name, TASK_QUEUE_OPTIONS[name]);
      await legacy.work<{ marker: string }>(
        name,
        { pollingIntervalSeconds: 0.5 },
        async (batch) => {
          for (const job of batch) oldSeen.push(`${name}:${job.data.marker}`);
        },
      );
      const payload = {
        organizationId: schema,
        runId: `new-${name}`,
        marker: 'new',
        seq: 1,
        pollMs: 1000,
        askId: 'ask',
        nodeId: 'node',
        execId: 'exec',
        sessionId: 'session',
        harness: 'fixture',
        providerSlug: 'fixture',
        gatewayModel: 'fixture',
        deadlineAt: Date.now() + 60_000,
      };
      const id = await sql.begin((tx) => addJobInTx(tx, name, payload));
      if (id === null)
        throw new Error(`protocol fixture enqueue refused: ${name}`);
      jobs.set(name, id);
      await legacy.send(name, { marker: 'old' });
    }
    const legacyWorked = await waitFor(
      async () => oldSeen.length >= QUEUES.length,
    );
    const waiting = await Promise.all(
      QUEUES.map(async (name) => {
        const id = jobs.get(name);
        return id === undefined
          ? null
          : current.getJobById(physicalTaskQueue(name), id);
      }),
    );
    record(
      'automation queues: all five live legacy subscribers consume their controls but none of the new payloads',
      legacyWorked &&
        QUEUES.every((name) => oldSeen.includes(`${name}:old`)) &&
        oldSeen.length === QUEUES.length &&
        waiting.every((job) => job?.state === 'created'),
      `legacy=${oldSeen.join(',')}; newStates=${waiting.map((job) => job?.state).join(',')}`,
    );
    await startWorker({
      boss: current,
      concurrency: 1,
      agentStartSlots: 1,
      agentDriveSlots: 1,
      automationOrgConcurrency: 1,
      taskList: Object.fromEntries(
        QUEUES.map((name) => [
          name,
          async () => {
            newSeen.push(name);
          },
        ]),
      ),
    });
    const currentWorked = await waitFor(async () => {
      const states = await Promise.all(
        QUEUES.map(async (name) => {
          const id = jobs.get(name);
          return id === undefined
            ? null
            : current.getJobById(physicalTaskQueue(name), id);
        }),
      );
      return states.every((job) => job?.state === 'completed');
    });
    record(
      'automation queues: the current worker consumes each protocol payload exactly once',
      currentWorked &&
        newSeen.length === QUEUES.length &&
        QUEUES.every((name) => newSeen.includes(name)) &&
        oldSeen.length === QUEUES.length,
      `current=${newSeen.join(',')}; legacyCount=${oldSeen.length}`,
    );

    const step = physicalTaskQueue('automation.step');
    await current.offWork(step, { wait: true });
    const delayed = await sql.begin((tx) =>
      addJobInTx(
        tx,
        'automation.step',
        { organizationId: schema, runId: 'cancel-control' },
        { startAfter: new Date(Date.now() + 60_000) },
      ),
    );
    if (delayed === null)
      throw new Error('protocol cancel fixture enqueue refused');
    await legacy.cancel('automation.step', delayed);
    const wrongQueue = await legacy.getJobById('automation.step', delayed);
    const beforeCancel = await current.getJobById(step, delayed);
    await current.cancel(step, delayed);
    record(
      'automation queues: read/cancel uses exact physical identity; an old-name cancel cannot withdraw new work',
      wrongQueue === null &&
        beforeCancel?.state === 'created' &&
        (await current.getJobById(step, delayed))?.state === 'cancelled',
      `oldRead=${wrongQueue === null ? 'absent' : 'present'}; before=${beforeCancel?.state}`,
    );

    let invoked = false;
    await startWorker({
      boss: current,
      sql,
      concurrency: 1,
      automationOrgConcurrency: 1,
      taskList: {
        'automation.step': async () => {
          invoked = true;
        },
      },
      shouldDefer: async () => true,
    });
    const handed = await sql.begin((tx) =>
      addJobInTx(
        tx,
        'automation.step',
        { organizationId: schema, runId: 'handover-control' },
        { singletonKey: 'handover', priority: 7 },
      ),
    );
    if (handed === null)
      throw new Error('protocol handover fixture enqueue refused');
    const handedOver = await waitFor(
      async () =>
        (await current.getJobById(step, handed))?.state === 'completed',
    );
    await current.offWork(step, { wait: true });
    const successors = await sql<
      {
        state: string;
        key: string | null;
        priority: number;
        group: string | null;
        heartbeat: number | null;
        delay: number;
      }[]
    >`
      SELECT state::text, singleton_key AS key, priority, group_id AS "group",
             heartbeat_seconds AS heartbeat,
             extract(epoch FROM start_after - created_on)::float8 AS delay
      FROM ${sql(schema)}.job
      WHERE name = ${step} AND data ->> 'runId' = 'handover-control' AND id <> ${handed}
    `;
    const successor = successors[0];
    record(
      'automation queues: drain hands over on the new queue, retaining payload, group, heartbeat, priority and delay',
      handedOver &&
        !invoked &&
        successors.length === 1 &&
        successor?.state === 'created' &&
        successor.key === 'handover' &&
        successor.priority === 7 &&
        successor.group === schema &&
        successor.heartbeat ===
          TASK_QUEUE_OPTIONS['automation.step'].heartbeatSeconds &&
        successor.delay >= 4 &&
        successor.delay <= 6 &&
        oldSeen.length === QUEUES.length,
      `handed=${handedOver}; successors=${JSON.stringify(successors)}; invoked=${invoked}`,
    );
    record(
      'automation queue fixture has no background pg-boss errors',
      errors.length === 0,
      errors.join(';'),
    );
  } catch (error) {
    failure = error;
  } finally {
    setEnqueueBoss(originalBoss);
    const stopped = await Promise.allSettled(
      [current, legacy].map(async (boss) => {
        try {
          await boss.stop({ graceful: true, timeout: 8000 });
        } catch (error) {
          failure ??= error;
          // pg-boss resets its stopping state even after a failed stop. A
          // bounded forced stop must close its workers/pool before DROP.
          await boss.stop({ graceful: false, timeout: 8000 });
        }
      }),
    );
    const confirmedStopped = stopped.every(
      (result) => result.status === 'fulfilled',
    );
    try {
      if (owned && confirmedStopped)
        await sql`DROP SCHEMA ${sql(schema)} CASCADE`;
    } catch (error) {
      failure ??= error;
    } finally {
      await sql.end({ timeout: 8 });
    }
    for (const result of stopped)
      if (result.status === 'rejected') failure ??= result.reason;
  }
  if (failure !== undefined) throw failure;
}

/** Read-side proof on the harness's real migrated schema, also BEFORE its
 * ordinary workers start. Every job and control-row write rolls back in one
 * bounded transaction. Only an absent legacy queue is created, then removed;
 * an existing legacy queue or its jobs are never changed. */
export async function checkAutomationProtocolReadback(
  sql: Sql,
  boss: PgBoss,
  record: Recorder,
): Promise<void> {
  const legacy = 'automation.agent_drive';
  const current = physicalTaskQueue(legacy);
  const ownsLegacy = (await boss.getQueue(legacy)) === null;
  if (ownsLegacy) await boss.createQueue(legacy, TASK_QUEUE_OPTIONS[legacy]);
  const rollback = new Error('rollback owned protocol read fixtures');
  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '8s'`;
      await tx`SET LOCAL lock_timeout = '8s'`;
      const now = Date.now();
      const execId = randomUUID();
      const db = bossDbInTx(tx);
      // These helpers use only the SQL tag, not pool or transaction methods.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- query-only helper input in an owned transaction
      const reader = tx as unknown as Sql;
      const send = async (queue: string, exec = execId) => {
        const id = await boss.send(
          queue,
          { execId: exec },
          {
            db,
            startAfter: new Date(now + 60_000),
          },
        );
        if (id === null)
          throw new Error('protocol read fixture enqueue refused');
        return id;
      };
      const pending = (
        queue: 'task.agent_drive' | 'automation.agent_drive',
        staleBeforeMs = now - 2000,
      ) => driveJobPending(reader, { queue, execId, staleBeforeMs });
      const oldId = await send(legacy);
      const oldOnly = await pending(legacy);
      const currentId = await send(current);
      const newQueued = await pending(legacy);
      await boss.cancel(current, currentId, { db });
      const cancelled = await pending(legacy);
      const taskId = await send('task.agent_drive');
      record(
        'automation recovery: exact current drive queue blocks duplicate recovery, while old-only and cancelled jobs do not',
        !oldOnly &&
          newQueued &&
          !cancelled &&
          (await pending('task.agent_drive')),
        `oldOnly=${oldOnly}, currentQueued=${newQueued}, cancelled=${cancelled}`,
      );
      await tx`
        INSERT INTO app.backend_control (
          key, draining, drain_started_at_ms, drain_expires_at_ms, updated_at_ms, draining_colour
        ) VALUES ('singleton', true, ${now}, ${now + 60_000}, ${now}, ${execId})
        ON CONFLICT (key) DO UPDATE SET draining = true,
          drain_started_at_ms = excluded.drain_started_at_ms,
          drain_expires_at_ms = excluded.drain_expires_at_ms,
          updated_at_ms = excluded.updated_at_ms, draining_colour = excluded.draining_colour
      `;
      const before = await countAutomationWork(reader);
      await tx`
        UPDATE pgboss.job SET state = 'active', started_on = to_timestamp(${(now - 1000) / 1000})
        WHERE id IN (${oldId}, ${currentId}, ${taskId})
      `;
      const afterId = await send(current, `${execId}-after`);
      await tx`
        UPDATE pgboss.job SET state = 'active', started_on = to_timestamp(${(now + 1000) / 1000})
        WHERE id = ${afterId}
      `;
      const after = await countAutomationWork(reader);
      record(
        'automation drain: counts current, legacy and task active drives, excluding a post-drain start',
        after.agentDrives === before.agentDrives + 3,
        `before=${before.agentDrives}, after=${after.agentDrives}`,
      );
      record(
        'automation recovery: current active drive age retains its existing stale boundary',
        (await pending(legacy)) && !(await pending(legacy, now - 500)),
        'one current active drive straddles the requested stale threshold',
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    if (ownsLegacy) await boss.deleteQueue(legacy);
  }
}
