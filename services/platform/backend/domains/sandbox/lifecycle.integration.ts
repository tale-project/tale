/** Real PostgreSQL interleavings across independent one-connection pools. */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import type { Sql, TransactionSql } from 'postgres';

import { createSql } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { lockOrgAdmission } from './admission-lock.ts';
import { scheduleSessionDestroy } from './destroy-schedule.ts';
import {
  pinSession,
  reconcileSession,
  recreatePinnedSession,
  schedulePinnedRecreate,
  teardownSession,
} from './service.ts';
import {
  markSessionDestroyed,
  reserveSessionSlot,
  resumeSessionSlot,
} from './sessions.ts';

function oneConnectionPool(databaseUrl: string): Sql {
  const before = process.env.DATABASE_POOL_MAX;
  try {
    process.env.DATABASE_POOL_MAX = '1';
    return createSql(databaseUrl);
  } finally {
    if (before === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = before;
  }
}

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export async function checkSandboxLifecycle(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('lifecycle proof needs DATABASE_URL');
  const first = oneConnectionPool(databaseUrl);
  const second = oneConnectionPool(databaseUrl);
  const orgId = `${ctx.orgId}:lifecycle:${randomUUID()}`;
  const sessionId = `lifecycle-${randomUUID()}`;
  const args = { organizationId: orgId, sessionId };
  const now = Date.now();
  const execId = randomUUID();
  const runId = randomUUID();
  const projectId = randomUUID();
  const taskId = randomUUID();
  const agentId = randomUUID();
  const gates: Array<ReturnType<typeof barrier>> = [];
  const gate = () => {
    const value = barrier();
    gates.push(value);
    return value;
  };
  const reset = async () => {
    await sql`
      UPDATE app.sandbox_sessions SET status = 'active', pinned = true,
        destroyed_at_ms = NULL WHERE org_id = ${orgId}
    `;
  };
  const state = async () =>
    (
      await sql<{ status: string; pinned: boolean }[]>`
    SELECT status, pinned FROM app.sandbox_sessions WHERE org_id = ${orgId}
  `
    )[0];
  // Observe a real cross-connection waiter, not a guessed delay. On the
  // unfixed implementation the competing operation finishes instead.
  const waitsForLock = async (operation: Promise<unknown>) => {
    let finished = false;
    void operation.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    const end = Date.now() + 5_000;
    while (Date.now() < end) {
      if (finished) return false;
      const waiting = await sql<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE pid = ${secondPid} AND locktype = 'advisory' AND NOT granted
        ) AS waiting
      `;
      if (waiting[0]?.waiting) return true;
      await delay(10);
    }
    return false;
  };
  const secondPid = (
    await second<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
  )[0]?.pid;
  if (secondPid === undefined) throw new Error('missing lifecycle pool PID');
  try {
    await sql`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, profile, status, owner_type, owner_id, created_by,
        pinned, created_at_ms, expires_at_ms
      ) VALUES (
        ${orgId}, ${sessionId}, '"agent"'::jsonb, 'active', 'project_agent',
        ${sessionId}, ${ctx.userId}, true, ${now}, ${now + 3_600_000}
      )
    `;
    await sql`
      INSERT INTO app.sandbox_session_tokens (
        org_id, session_id, token_hash, scope, created_at_ms, expires_at_ms
      ) VALUES (${orgId}, ${sessionId}, ${randomUUID()}, '{}'::jsonb,
        ${now}, ${now + 3_600_000})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Lifecycle proof', ${ctx.userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model, created_by, created_at_ms, updated_at_ms)
      VALUES (${agentId}, ${orgId}, ${projectId}, 'Lifecycle agent', 'opencode', 'itest', ${ctx.userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'Lifecycle proof', 'in_progress', 'a0', ${ctx.userId}, 'user', ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.project_agent_runs (
        id, org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, waiting_for_capacity_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${runId}, ${orgId}, ${projectId}, ${taskId}, ${agentId},
        ${execId}, ${sessionId}, 'queued', 'claude-code', 'itest-model',
        ${ctx.userId}, ${now}, ${now}, ${now + 3_600_000}, ${now}
      )
    `;
    let alive = true;
    let remotePinned = true;
    let creates = 0;
    const spawner = {
      isAlive: async () => alive,
      create: async () => {
        creates += 1;
        alive = true;
      },
      setPinned: async (_id: string, pinned: boolean) => {
        remotePinned = pinned;
        return true;
      },
    };
    // The sweep's probes queue a recreate instead of running it; recorded
    // here, so no worker ever sees one from this lane.
    const scheduled: string[] = [];
    const schedule = async (
      _sql: unknown,
      scheduledArgs: { sessionId: string },
    ): Promise<void> => {
      scheduled.push(scheduledArgs.sessionId);
    };
    // Destroy removes the workspace (and the spawner's pin) but has not
    // committed its row yet.
    const destroyed = gate();
    const finishDestroy = gate();
    const destroying = teardownSession(
      first,
      args,
      async () => {
        alive = false;
        destroyed.release();
        await finishDestroy.promise;
        return true;
      },
      spawner.setPinned,
    );
    await destroyed.promise;
    // A sweep probe does not queue behind the transition: it skips the row.
    const probeDuringDestroy = await reconcileSession(second, args, spawner, {
      schedule,
    });
    // The recreate job waits for the lock, then reads the settled row.
    const afterDestroy = recreatePinnedSession(second, args, spawner);
    const destroyWait = await waitsForLock(afterDestroy);
    finishDestroy.release();
    const [didDestroy, afterDestroyOutcome] = await Promise.all([
      destroying,
      afterDestroy,
    ]);
    record(
      'sandbox lifecycle: a Destroy in flight cannot resurrect an empty workspace',
      destroyWait &&
        didDestroy &&
        probeDuringDestroy === 'skipped' &&
        afterDestroyOutcome === 'skipped' &&
        scheduled.length === 0 &&
        !alive &&
        !remotePinned &&
        creates === 0 &&
        (await state())?.status === 'destroyed',
      `probe=${probeDuringDestroy}, job waited=${destroyWait}, job outcome=${afterDestroyOutcome}, scheduled=${scheduled.length}, creates=${creates}, alive=${alive}, spawner pinned=${remotePinned}`,
    );
    const tokens = await sql<{ revoked: boolean }[]>`
      SELECT revoked_at_ms IS NOT NULL AS revoked FROM app.sandbox_session_tokens
      WHERE org_id = ${orgId}
    `;
    const jobs = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = 'task.agent_turn' AND data ->> 'runId' = ${runId}
    `;
    record(
      'sandbox lifecycle: destruction revokes tokens and wakes capacity with a one-connection app pool',
      tokens[0]?.revoked && jobs[0]?.count === '1',
      `revoked=${tokens[0]?.revoked}, wake jobs=${jobs[0]?.count} (want 1); pool max=1`,
    );

    await reset();
    alive = false;
    creates = 0;
    const creating = gate();
    const finishCreate = gate();
    const recreate = recreatePinnedSession(first, args, {
      ...spawner,
      create: async () => {
        creating.release();
        await finishCreate.promise;
        creates += 1;
        alive = true;
      },
    });
    await creating.promise;
    // The page's probe answers at once while the create runs, queueing
    // nothing: it neither waits for the lock nor doubles the recreate.
    const probeDuringRecreate = await reconcileSession(sql, args, spawner, {
      schedule,
    });
    const destroyAfter = teardownSession(
      second,
      args,
      async () => {
        alive = false;
        return true;
      },
      spawner.setPinned,
    );
    const recreateWait = await waitsForLock(destroyAfter);
    finishCreate.release();
    const [recreateOutcome] = await Promise.all([recreate, destroyAfter]);
    record(
      'sandbox lifecycle: Destroy waits for an in-flight recreate then destroys it; a probe skips it without waiting',
      recreateWait &&
        recreateOutcome === 'recreated' &&
        probeDuringRecreate === 'skipped' &&
        scheduled.length === 0 &&
        !alive &&
        creates === 1 &&
        (await state())?.status === 'destroyed',
      `waited=${recreateWait}, recreate=${recreateOutcome}, probe=${probeDuringRecreate}, scheduled=${scheduled.length}, creates=${creates}, alive=${alive}`,
    );

    // The real scheduler queues ONE job per session: the queue is
    // `exclusive`, so a second schedule while the first is pending adds
    // nothing. Both sends share one transaction, so no worker can take the
    // first before the second is refused.
    const queuedFor = {
      organizationId: orgId,
      sessionId: `${sessionId}:queue`,
    };
    await sql.begin(async (tx) => {
      await schedulePinnedRecreate(tx, queuedFor);
      await schedulePinnedRecreate(tx, queuedFor);
    });
    const queued = await sql<{ count: string; policy: string | null }[]>`
      SELECT count(*)::text AS count,
        (SELECT policy FROM pgboss.queue WHERE name = 'sandbox.recreate_pinned') AS policy
      FROM pgboss.job
      WHERE name = 'sandbox.recreate_pinned'
        AND singleton_key = ${JSON.stringify([queuedFor.organizationId, queuedFor.sessionId])}
        AND data ->> 'sessionId' = ${queuedFor.sessionId}
    `;
    record(
      'sandbox lifecycle: a pinned recreate is queued once per session on an exclusive queue',
      queued[0]?.count === '1' && queued[0]?.policy === 'exclusive',
      `jobs=${queued[0]?.count} (want 1), policy=${queued[0]?.policy} (want exclusive)`,
    );

    await reset();
    alive = true;
    remotePinned = true;
    const pinning = gate();
    const finishPin = gate();
    const repin = reconcileSession(first, args, {
      ...spawner,
      setPinned: async () => {
        pinning.release();
        await finishPin.promise;
        remotePinned = true;
        return true;
      },
    });
    await pinning.promise;
    const unpin = pinSession(
      second,
      { ...args, pinned: false },
      spawner.setPinned,
    );
    const unpinWait = await waitsForLock(unpin);
    finishPin.release();
    await Promise.all([repin, unpin]);
    const unpinnedRow = await state();
    record(
      'sandbox lifecycle: an unpin cannot be undone by an in-flight re-pin',
      unpinWait &&
        !remotePinned &&
        unpinnedRow !== undefined &&
        !unpinnedRow.pinned,
      `waited=${unpinWait}, spawner pinned=${remotePinned}, row pinned=${(await state())?.pinned}`,
    );

    await checkLifecycleDurability(sql, first, ctx, record);
    await checkDestroyAdmission(sql, first, second, waitsForLock, ctx, record);
  } finally {
    for (const item of gates) item.release();
    await Promise.all([first.end({ timeout: 1 }), second.end({ timeout: 1 })]);
    await sql`DELETE FROM pgboss.job WHERE data ->> 'organizationId' = ${orgId}`;
    await sql`DELETE FROM app.project_agent_runs WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.projects WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_session_tokens WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId}`;
  }
}

/** A gateway delete cannot be rolled back, nor can a destroyed workspace.
 * Inject failures AFTER each remote effect and observe the durable state
 * from another connection, including spend at the instant the key is deleted. */
async function checkLifecycleDurability(
  sql: Sql,
  pool: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const orgId = `${ctx.orgId}:durability:${randomUUID()}`;
  const sessionId = `durability-${randomUUID()}`;
  const execId = randomUUID();
  const keyId = `itest-key-${randomUUID()}`;
  const args = { organizationId: orgId, sessionId };
  let alive = true;
  let keyAlive = true;
  let creates = 0;
  let committedBeforeDelete = false;
  const durableSpend = () => sql<
    { settled: boolean; spent: number; booked: number }[]
  >`
    SELECT spend_settled_at_ms IS NOT NULL AS settled,
      spent_cents::float8 AS spent,
      (SELECT coalesce(sum(cost_estimate_cents), 0)::float8 FROM app.usage_ledger
        WHERE org_id = ${orgId} AND granularity = 'monthly') AS booked
    FROM app.sandbox_session_ops
    WHERE session_id = ${sessionId} AND exec_id = ${execId}
  `;
  const gateway = createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && keyAlive) {
      res.end(
        JSON.stringify({ virtual_key: { budgets: [{ current_usage: 0.25 }] } }),
      );
    } else if (req.method === 'DELETE') {
      void durableSpend().then(
        (rows) => {
          committedBeforeDelete =
            rows[0]?.settled && rows[0]?.spent === 25 && rows[0]?.booked === 25;
          keyAlive = false;
          res.end('{}');
        },
        () => {
          res.statusCode = 500;
          res.end('{}');
        },
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => {
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const address = gateway.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;
  const previousUrl = process.env.SANDBOX_LLM_GATEWAY_URL;
  process.env.SANDBOX_LLM_GATEWAY_URL = `http://127.0.0.1:${port}`;
  const failure = new Error('injected failure after the remote effect');
  const spawner = {
    isAlive: async () => alive,
    create: async () => {
      alive = true;
      creates += 1;
    },
    setPinned: async () => true,
  };
  const recreateInline = { recreate: 'inline' as const };
  try {
    const now = Date.now();
    await sql`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, profile, status, owner_type, owner_id, created_by,
        pinned, created_at_ms, expires_at_ms
      ) VALUES (${orgId}, ${sessionId}, '"agent"'::jsonb, 'active',
        'project_agent', ${sessionId}, ${ctx.userId}, true, ${now}, ${now + 3_600_000})
    `;
    // The remote may destroy the files even when its response never arrives.
    const interrupted = await teardownSession(
      pool,
      args,
      async () => {
        alive = false;
        throw failure;
      },
      spawner.setPinned,
    ).then(
      () => false,
      (error: unknown) => error === failure,
    );
    const before = (
      await sql<{ status: string; pinned: boolean }[]>`
      SELECT status, pinned FROM app.sandbox_sessions WHERE org_id = ${orgId}
    `
    )[0];
    const healed = await reconcileSession(pool, args, spawner, recreateInline);
    record(
      'sandbox lifecycle: an uncertain Destroy persists unpin intent before losing its response',
      interrupted &&
        before?.status === 'active' &&
        !before.pinned &&
        healed === 'healed' &&
        !alive &&
        creates === 0,
      `failed=${interrupted}, row before retry=${before?.status}/pinned=${before?.pinned}, retry=${healed}, alive=${alive}, recreates=${creates}`,
    );

    await sql`UPDATE app.sandbox_sessions SET status = 'active', pinned = true, destroyed_at_ms = NULL WHERE org_id = ${orgId}`;
    await sql`
      INSERT INTO app.sandbox_session_ops (
        org_id, session_id, exec_id, kind, status, started_at_ms, minted_key_id, user_id
      ) VALUES (${orgId}, ${sessionId}, ${execId}, 'task-agent', 'completed', ${now}, ${keyId}, ${ctx.userId})
    `;
    await sql`
      INSERT INTO app.sandbox_session_tokens (
        org_id, session_id, token_hash, scope, created_at_ms, expires_at_ms, llm_gateway_key_id
      ) VALUES (${orgId}, ${sessionId}, ${randomUUID()}, '{}'::jsonb, ${now}, ${now + 3_600_000}, ${keyId})
    `;
    // Fail the outer lifecycle transaction after every callback action. The
    // key is already gone; the spend/row commits must survive independently.
    const rollbackPool = new Proxy(pool, {
      get(target, property, receiver) {
        if (property === 'begin')
          return (work: (tx: TransactionSql) => Promise<unknown>) =>
            target.begin(async (tx) => {
              await work(tx);
              throw failure;
            });
        return Reflect.get(target, property, receiver);
      },
    });
    const rolledBack = await teardownSession(
      rollbackPool,
      args,
      async () => {
        alive = false;
        return true;
      },
      spawner.setPinned,
    ).then(
      () => false,
      (error: unknown) => error === failure,
    );
    const spent = (await durableSpend())[0];
    const row = (
      await sql<
        { status: string }[]
      >`SELECT status FROM app.sandbox_sessions WHERE org_id = ${orgId}`
    )[0];
    record(
      'sandbox lifecycle: key deletion follows committed spend that survives a later lock-transaction rollback',
      rolledBack &&
        !keyAlive &&
        committedBeforeDelete &&
        spent?.settled &&
        spent.spent === 25 &&
        spent.booked === 25 &&
        row?.status === 'destroyed',
      `rolledBack=${rolledBack}, keyAlive=${keyAlive}, committedBeforeDelete=${committedBeforeDelete}, settled=${spent?.settled}, spent/booked=${spent?.spent}/${spent?.booked}, row=${row?.status}`,
    );
    const afterRollback = await reconcileSession(
      pool,
      args,
      spawner,
      recreateInline,
    );
    record(
      'sandbox lifecycle: failed lock commit after remote Destroy cannot resurrect the workspace',
      !alive &&
        creates === 0 &&
        (afterRollback === 'skipped' || afterRollback === 'healed'),
      `retry=${afterRollback}, alive=${alive}, recreates=${creates}`,
    );
  } finally {
    if (previousUrl === undefined) delete process.env.SANDBOX_LLM_GATEWAY_URL;
    else process.env.SANDBOX_LLM_GATEWAY_URL = previousUrl;
    await new Promise<void>((resolve) => {
      gateway.close(() => resolve());
    });
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_session_tokens WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId}`;
  }
}

/** What an admission verb answered: the turn let in, refused because its
 * workspace is being deleted, or anything else, named. */
async function admission(attempt: Promise<unknown>): Promise<string> {
  try {
    const value = await attempt;
    return value === false ? 'absent' : 'admitted';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota =
      error instanceof Error &&
      'code' in error &&
      error.code === 'QUOTA_EXCEEDED';
    return quota && message.includes('is deleting this sandbox workspace')
      ? 'refused'
      : `error: ${message}`;
  }
}

/**
 * A Destroy that is queued, retrying or running closes its row to new work.
 * Its retry can come a quarter to half an hour after the request, and checks
 * only that the row is still the one it was asked for: a resume keeps the
 * row id, so a turn let in between two attempts would have its files, its
 * tokens and its gateway keys removed by the next one. The hosts' one
 * admission (`reserveSessionSlot`, `resumeSessionSlot`, under the
 * organization's admission lock) refuses the session until the Destroy has
 * settled, and the request takes the same lock. A pending Destroy here is a
 * real queue row whose next attempt is a day away, so no worker takes it.
 */
async function checkDestroyAdmission(
  sql: Sql,
  first: Sql,
  second: Sql,
  waitsForLock: (operation: Promise<unknown>) => Promise<boolean>,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error('destroy admission proof needs DATABASE_URL');
  const orgId = `${ctx.orgId}:destroy-admission:${randomUUID()}`;
  const otherOrgId = `${ctx.orgId}:destroy-admission-other:${randomUUID()}`;
  const agentId = randomUUID();
  const sessionId = `pa-${agentId}`;
  const args = { organizationId: orgId, sessionId };
  const reserveArgs = {
    ...args,
    profile: 'agent',
    ownerType: 'project_agent',
    ownerId: agentId,
    createdBy: ctx.userId,
  };
  const stopped = async (organizationId = orgId): Promise<string> => {
    // A fresh incarnation is the newest row under the id by its creation.
    await delay(2);
    const now = Date.now();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, profile, status, owner_type, owner_id, created_by,
        pinned, created_at_ms, expires_at_ms, last_activity_at_ms
      ) VALUES (
        ${organizationId}, ${sessionId}, '"agent"'::jsonb, 'stopped',
        'project_agent', ${agentId}, ${ctx.userId}, false, ${now},
        ${now + 3_600_000}, ${now}
      )
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('missing destroy-admission row');
    return id;
  };
  const rowStates = async (organizationId = orgId) =>
    (
      await sql<{ id: string; status: string; lastActivityAt: number }[]>`
        SELECT id, status, last_activity_at_ms::float8 AS "lastActivityAt"
        FROM app.sandbox_sessions
        WHERE org_id = ${organizationId} AND session_id = ${sessionId}
        ORDER BY created_at_ms
      `
    ).map((row) => row.status);
  const pendingDestroy = async (rowId: string, organizationId = orgId) => {
    await sql.begin((tx) =>
      addJobInTx(
        tx,
        'sandbox.destroy_session',
        { organizationId, sessionId, rowId },
        {
          singletonKey: JSON.stringify([organizationId, sessionId, rowId]),
          startAfter: new Date(Date.now() + 86_400_000),
        },
      ),
    );
  };
  // pg-boss's own end of a ladder: the last attempt failed, or one succeeded.
  const endDestroys = async (outcome: 'failed' | 'completed') => {
    if (outcome === 'failed') {
      await sql`
        UPDATE pgboss.job SET state = 'failed', completed_on = now()
        WHERE name = 'sandbox.destroy_session'
          AND data ->> 'organizationId' = ${orgId}
          AND state IN ('created', 'retry', 'active')
      `;
    } else {
      await sql`
        UPDATE pgboss.job SET state = 'completed', completed_on = now()
        WHERE name = 'sandbox.destroy_session'
          AND data ->> 'organizationId' = ${orgId}
          AND state IN ('created', 'retry', 'active')
      `;
    }
  };
  const destroyJobs = async () =>
    (
      await sql<{ state: string }[]>`
        SELECT state::text AS state FROM pgboss.job
        WHERE name = 'sandbox.destroy_session'
          AND data ->> 'organizationId' = ${orgId}
        ORDER BY created_on
      `
    ).map((job) => job.state);
  const clear = async () => {
    await sql`
      DELETE FROM pgboss.job WHERE name = 'sandbox.destroy_session'
        AND data ->> 'organizationId' = ANY(${[orgId, otherOrgId]})
    `;
    await sql`DELETE FROM app.sandbox_session_tokens WHERE org_id = ANY(${[orgId, otherOrgId]})`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ANY(${[orgId, otherOrgId]})`;
  };
  const gates: Array<ReturnType<typeof barrier>> = [];
  const gate = () => {
    const value = barrier();
    gates.push(value);
    return value;
  };
  const unpinned = async () => true;
  try {
    // 1. The first attempt failed; the retry holds the session's lifecycle
    // lock and is deleting the workspace when a turn asks to resume it. The
    // turn is refused before the row changes, and the deletion settles a
    // row nobody resumed — the session's token goes with it.
    const asked = await stopped();
    await sql`
      INSERT INTO app.sandbox_session_tokens (
        org_id, session_id, token_hash, scope, created_at_ms, expires_at_ms
      ) VALUES (${orgId}, ${sessionId}, ${randomUUID()}, '{}'::jsonb,
        ${Date.now()}, ${Date.now() + 3_600_000})
    `;
    await pendingDestroy(asked);
    const deleting = gate();
    const finishDelete = gate();
    let deletes = 0;
    const attempt = teardownSession(
      first,
      { ...args, rowId: asked },
      async () => {
        deletes += 1;
        deleting.release();
        await finishDelete.promise;
        return true;
      },
      unpinned,
    );
    await deleting.promise;
    const duringAttempt = await admission(resumeSessionSlot(second, args));
    const rowDuringAttempt = await rowStates();
    finishDelete.release();
    const attempted = await attempt;
    const tokenRevoked = (
      await sql<{ revoked: boolean }[]>`
        SELECT revoked_at_ms IS NOT NULL AS revoked
        FROM app.sandbox_session_tokens WHERE org_id = ${orgId}
      `
    )[0]?.revoked;
    record(
      'sandbox Destroy admission: a resume while a retry deletes the workspace is refused before it starts',
      duringAttempt === 'refused' &&
        rowDuringAttempt.join() === 'stopped' &&
        attempted &&
        deletes === 1 &&
        (await rowStates()).join() === 'destroyed' &&
        (tokenRevoked ?? false),
      `resume during the retry=${duringAttempt} (want refused), row then=${rowDuringAttempt.join()} (want stopped), retry settled=${attempted}, deletes=${deletes}, row after=${(await rowStates()).join()}, token revoked=${tokenRevoked}`,
    );

    // 2. The other order: a resume holds the organization's admission
    // section when the Destroy is asked for. The request waits for it, so a
    // resume is either before the request (the Destroy cancels that turn, as
    // it cancels any running work) or after it, and refused.
    await clear();
    await stopped();
    const admitting = gate();
    const finishAdmitting = gate();
    const heldAdmission = first.begin(async (tx) => {
      await lockOrgAdmission(tx, orgId);
      admitting.release();
      await finishAdmitting.promise;
    });
    await admitting.promise;
    const requesting = scheduleSessionDestroy(second, args);
    const requestWaited = await waitsForLock(requesting);
    finishAdmitting.release();
    await heldAdmission;
    const requested = await requesting;
    // Keep the request's own job off the workers for the rest of the check.
    await sql`
      UPDATE pgboss.job SET start_after = now() + interval '1 day'
      WHERE name = 'sandbox.destroy_session'
        AND data ->> 'organizationId' = ${orgId}
        AND state IN ('created', 'retry')
    `;
    const afterRequest = await admission(resumeSessionSlot(second, args));
    const freshBeside = await admission(
      reserveSessionSlot(second, reserveArgs),
    );
    record(
      'sandbox Destroy admission: a request waits for an admission in progress, and a turn after it is refused',
      requestWaited &&
        requested &&
        afterRequest === 'refused' &&
        freshBeside === 'refused' &&
        (await rowStates()).join() === 'stopped',
      `request waited for the admission lock=${requestWaited}, queued=${requested}, resume after it=${afterRequest} (want refused), fresh reserve beside it=${freshBeside} (want refused), rows=${(await rowStates()).join()}`,
    );

    // 3. Asked again while it is pending: absorbed, still one job, still
    // refused. Once every attempt has failed the row reads "Destroy failed"
    // and is open again — an agent's workspace id is deterministic, so a
    // Destroy that never succeeds cannot lock it for good. Asked again
    // after that, a new Destroy closes it again.
    const again = await scheduleSessionDestroy(second, args);
    const jobsWhilePending = await destroyJobs();
    await endDestroys('failed');
    const afterFailure = await admission(resumeSessionSlot(second, args));
    await sql`
      UPDATE app.sandbox_sessions SET status = 'stopped'
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
    `;
    const askedAgain = await scheduleSessionDestroy(second, args);
    await sql`
      UPDATE pgboss.job SET start_after = now() + interval '1 day'
      WHERE name = 'sandbox.destroy_session'
        AND data ->> 'organizationId' = ${orgId}
        AND state IN ('created', 'retry')
    `;
    const afterAskedAgain = await admission(resumeSessionSlot(second, args));
    record(
      'sandbox Destroy admission: a repeated Destroy is absorbed while pending, a failed one reopens the row, a new one closes it',
      again &&
        jobsWhilePending.length === 1 &&
        afterFailure === 'admitted' &&
        askedAgain &&
        afterAskedAgain === 'refused',
      `asked again=${again} (jobs=${jobsWhilePending.join('/')}, want one), resume after the ladder failed=${afterFailure} (want admitted), new Destroy=${askedAgain}, resume then=${afterAskedAgain} (want refused)`,
    );

    // 4. Eventual success: the retry deletes the workspace nobody was let
    // into, and the next start opens a fresh incarnation under the same id;
    // the settled Destroy says nothing about it.
    const current = (
      await sql<{ id: string }[]>`
        SELECT id FROM app.sandbox_sessions
        WHERE org_id = ${orgId} AND session_id = ${sessionId}
        ORDER BY created_at_ms DESC LIMIT 1
      `
    )[0]?.id;
    const settled = await teardownSession(
      first,
      { ...args, rowId: current ?? '' },
      async () => true,
      unpinned,
    );
    // Its job has not finished yet; the row it settled holds nothing.
    const fresh = await admission(reserveSessionSlot(second, reserveArgs));
    await endDestroys('completed');
    const freshRows = await rowStates();
    record(
      'sandbox Destroy admission: once the Destroy has deleted the workspace, the next start opens a fresh incarnation',
      settled &&
        fresh === 'admitted' &&
        freshRows.at(-1) === 'creating' &&
        freshRows.slice(0, -1).every((status) => status === 'destroyed'),
      `retry settled=${settled}, fresh reserve=${fresh} (want admitted), rows=${freshRows.join()}`,
    );

    // 5. A newer incarnation is not this Destroy's: one still pending for a
    // row the reconcile settled meanwhile blocks nothing under the id, and
    // its retry leaves the fresh row alone.
    await clear();
    const healed = await stopped();
    await pendingDestroy(healed);
    await markSessionDestroyed(sql, args);
    const newer = await admission(reserveSessionSlot(second, reserveArgs));
    await sql`
      UPDATE app.sandbox_sessions SET status = 'stopped'
      WHERE org_id = ${orgId} AND status = 'creating'
    `;
    const newerResume = await admission(resumeSessionSlot(second, args));
    let staleDeletes = 0;
    const stale = await teardownSession(
      first,
      { ...args, rowId: healed },
      async () => {
        staleDeletes += 1;
        return true;
      },
      unpinned,
    );
    record(
      'sandbox Destroy admission: a Destroy pending for a settled incarnation blocks no newer one',
      newer === 'admitted' &&
        newerResume === 'admitted' &&
        !stale &&
        staleDeletes === 0 &&
        (await rowStates()).join() === 'destroyed,active',
      `fresh reserve=${newer}, its resume=${newerResume} (want both admitted), stale retry=${stale}, deletes=${staleDeletes}, rows=${(await rowStates()).join()}`,
    );

    // 6. Organization isolation: the same session id in another
    // organization is not held by this organization's Destroy.
    await clear();
    const closed = await stopped();
    await stopped(otherOrgId);
    await pendingDestroy(closed);
    const ownOrg = await admission(resumeSessionSlot(second, args));
    const otherOrg = await admission(
      resumeSessionSlot(second, { organizationId: otherOrgId, sessionId }),
    );
    record(
      "sandbox Destroy admission: a Destroy holds its own organization's row only",
      ownOrg === 'refused' && otherOrg === 'admitted',
      `own organization=${ownOrg} (want refused), other organization's same id=${otherOrg} (want admitted)`,
    );

    // 7. A settlement that commits between the resume's row read and its
    // predicate. A terminal write takes no admission lock (a Destroy's
    // settle runs under the session's lifecycle lock; a heal or a reclaim
    // under none), so the predicate can find the row already settled — no
    // live row, so no pending Destroy — and the resume must still not move
    // that row back to active and hand its turn the old incarnation. A lock
    // on the queue's table pauses the resume exactly there: its read is
    // done and its predicate waits for the lock, seen in `pg_locks`. The
    // settlement then commits on a connection of its own. Once with the
    // Destroy's job unfinished (its attempt is the one settling), once with
    // none (a heal).
    const third = oneConnectionPool(databaseUrl);
    try {
      const secondPid = (
        await second<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      )[0]?.pid;
      const pausedOnRelation = async (operation: Promise<unknown>) => {
        let finished = false;
        void operation.then(
          () => {
            finished = true;
          },
          () => {
            finished = true;
          },
        );
        const end = Date.now() + 5_000;
        while (Date.now() < end) {
          if (finished) return false;
          const waiting = await third<{ waiting: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_locks
              WHERE pid = ${secondPid ?? -1} AND locktype = 'relation'
                AND NOT granted
            ) AS waiting
          `;
          if (waiting[0]?.waiting) return true;
          await delay(10);
        }
        return false;
      };
      for (const settlement of ['a Destroy attempt', 'a heal'] as const) {
        await clear();
        const settledRow = await stopped();
        if (settlement === 'a Destroy attempt')
          await pendingDestroy(settledRow);
        const queueLocked = gate();
        const releaseQueue = gate();
        const holder = first.begin(async (tx) => {
          await tx`LOCK TABLE pgboss.job IN ACCESS EXCLUSIVE MODE`;
          queueLocked.release();
          await releaseQueue.promise;
        });
        await queueLocked.promise;
        const resuming = admission(resumeSessionSlot(second, args));
        const paused = await pausedOnRelation(resuming);
        const settledMeanwhile = await markSessionDestroyed(third, args);
        releaseQueue.release();
        await holder;
        const resumed = await resuming;
        const row = (
          await sql<{ status: string; destroyedAt: number | null }[]>`
            SELECT status, destroyed_at_ms::float8 AS "destroyedAt"
            FROM app.sandbox_sessions WHERE id = ${settledRow}
          `
        )[0];
        record(
          `sandbox Destroy admission: a resume never revives a row settled between its read and its predicate (${settlement})`,
          paused &&
            settledMeanwhile &&
            resumed === 'absent' &&
            row?.status === 'destroyed',
          `resume paused between its read and its predicate=${paused}, settlement committed meanwhile=${settledMeanwhile}, resume=${resumed} (want absent), row after=${row?.status ?? 'none'} (want destroyed)${row?.status === 'active' && row.destroyedAt !== null ? ', revived with its destroyed stamp' : ''}`,
        );
      }
    } finally {
      await third.end({ timeout: 1 });
    }
  } finally {
    for (const item of gates) item.release();
    await clear();
  }
}
