/** Real PostgreSQL interleavings across independent one-connection pools. */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import type { Sql, TransactionSql } from 'postgres';

import { createSql } from '../../db/sql.ts';
import { pinSession, reconcileSession, teardownSession } from './service.ts';

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
    // Destroy removes the workspace but has not committed its row yet.
    const destroyed = gate();
    const finishDestroy = gate();
    const destroying = teardownSession(first, args, async () => {
      alive = false;
      destroyed.release();
      await finishDestroy.promise;
      return true;
    });
    await destroyed.promise;
    const afterDestroy = reconcileSession(second, args, spawner);
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
        afterDestroyOutcome === 'healed' &&
        !alive &&
        creates === 0 &&
        (await state())?.status === 'destroyed',
      `waited=${destroyWait}, outcome=${afterDestroyOutcome}, creates=${creates}, alive=${alive}`,
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
    const recreate = reconcileSession(first, args, {
      ...spawner,
      create: async () => {
        creating.release();
        await finishCreate.promise;
        creates += 1;
        alive = true;
      },
    });
    await creating.promise;
    const destroyAfter = teardownSession(second, args, async () => {
      alive = false;
      return true;
    });
    const recreateWait = await waitsForLock(destroyAfter);
    finishCreate.release();
    await Promise.all([recreate, destroyAfter]);
    record(
      'sandbox lifecycle: Destroy waits for an in-flight recreate then destroys it',
      recreateWait &&
        !alive &&
        creates === 1 &&
        (await state())?.status === 'destroyed',
      `waited=${recreateWait}, creates=${creates}, alive=${alive}`,
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
    const interrupted = await teardownSession(pool, args, async () => {
      alive = false;
      throw failure;
    }).then(
      () => false,
      (error: unknown) => error === failure,
    );
    const before = (
      await sql<{ status: string; pinned: boolean }[]>`
      SELECT status, pinned FROM app.sandbox_sessions WHERE org_id = ${orgId}
    `
    )[0];
    const healed = await reconcileSession(pool, args, spawner);
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
    const rolledBack = await teardownSession(rollbackPool, args, async () => {
      alive = false;
      return true;
    }).then(
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
    const afterRollback = await reconcileSession(pool, args, spawner);
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
