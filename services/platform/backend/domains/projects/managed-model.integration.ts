/** Native model-only adoption, using the integration catalog and nonce-owned
 * rows. Any real kick is cancelled in its own transaction before a worker can
 * observe it; no model request or sandbox is started. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import { configurationHashSchema } from '@tale/shared/schemas/configuration';
import { managedAgentModelObservationSchema } from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { cancelAgentRunInTx, kickAgentRun } from '../tasks/agent-runs.ts';
import {
  getProjectAgent,
  readAgentModelConfiguration,
  updateAgentModelConfiguration,
  updateProjectAgent,
} from './service.ts';

export async function checkManagedAgentModel(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  ids: { projectId: string; agentId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const auth = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const agentId = randomUUID();
  const taskIds = [randomUUID(), randomUUID(), randomUUID()];
  const { projectId } = ids;
  const now = Date.now();
  await sql`
    INSERT INTO app.project_agents (
      id, org_id, project_id, name, harness, model, model_provider,
      skills, connectors, tools, secrets, instructions, managed, created_by,
      created_at_ms, updated_at_ms, handle, legacy_handles
    ) SELECT ${agentId}, org_id, project_id, 'Managed model fixture', 'codex',
      'test-model', NULL, ARRAY['unavailable-fixture-skill']::text[],
      ARRAY['unavailable-fixture-connector']::text[], tools,
      ARRAY['UNAVAILABLE_FIXTURE_SECRET']::text[], instructions, false, created_by,
      ${now}, ${now + 86_400_000}, ${`model-${agentId}`}, ARRAY[]::text[]
    FROM app.project_agents WHERE id = ${ids.agentId}
      AND project_id = ${projectId} AND org_id = ${ctx.orgId}
  `;
  const path = `/api/app/projects/${projectId}/agents/${agentId}/configuration/model?orgId=${ctx.orgId}`;
  const snapshot = z.strictObject({
    config: managedAgentModelObservationSchema,
    hash: configurationHashSchema,
  });
  const read = (tx: Sql | TransactionSql = sql) =>
    readAgentModelConfiguration(tx, auth, projectId, agentId);
  const request = (body?: unknown, cookie = ctx.cookie) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  const desired = {
    projectId,
    agentId,
    harness: 'opencode',
    model: 'itest-agent-model',
    modelProvider: 'itestagent',
  };
  const write = (tx: TransactionSql, expectedHash: string, model = desired) =>
    updateAgentModelConfiguration(tx, auth, model, expectedHash);
  const preserved = async () => {
    const [row] =
      await sql`SELECT to_jsonb(a) - 'harness' - 'model' - 'model_provider' - 'updated_at_ms' AS fields
      FROM app.project_agents a WHERE id = ${agentId} AND org_id = ${ctx.orgId}`;
    return row?.fields;
  };
  try {
    const initialResponse = await request();
    assert.equal(initialResponse.status, 200);
    const initial = snapshot.parse(await initialResponse.json());
    assert.deepEqual(initial, await read());
    assert.equal(initial.config.modelProvider, null);
    assert.equal((await request(undefined, '')).status, 401);
    const before = await preserved();
    for (const config of [
      { ...desired, agentId: 'foreign' },
      { ...desired, projectId: 'foreign' },
      { ...desired, modelProvider: null },
      { ...desired, secrets: [] },
    ])
      assert.equal(
        (await request({ config, expectedHash: initial.hash })).status,
        400,
      );
    assert.equal((await request({ config: desired })).status, 400);
    assert.equal(
      (
        await request({
          config: {
            ...desired,
            modelProvider: 'unconfigured-fixture-provider',
          },
          expectedHash: initial.hash,
        })
      ).status,
      400,
    );
    assert.deepEqual(await read(), initial);

    // Seed admitted queued/running tuples without jobs. The managed writer must
    // preserve both exactly; this is not a physical running-harness proof.
    for (const [index, taskId] of taskIds.entries()) {
      await sql`INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type, assignee_id, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
        VALUES (${taskId}, ${ctx.orgId}, ${projectId}, 'Model admission fixture', 'todo', 'agent', ${agentId}, ${`a${index}`}, ${ctx.userId}, 'user', ${now}, ${now})`;
      if (index < 2)
        await sql`INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, model_provider, started_by, started_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (${ctx.orgId}, ${projectId}, ${taskId}, ${agentId}, ${randomUUID()}, ${`pa-${agentId}-fixture-${index}`},
        ${index === 0 ? 'queued' : 'running'}, 'codex', 'test-model', NULL, ${ctx.userId}, ${now}, ${now + 3_600_000}, ${now})`;
    }
    const runState =
      () => sql`SELECT to_jsonb(r) AS state FROM app.project_agent_runs r
      WHERE org_id = ${ctx.orgId} AND task_id = ANY(${taskIds.slice(0, 2)}) ORDER BY task_id`;
    const admitted = await runState();
    assert.equal(
      (await request({ config: desired, expectedHash: initial.hash })).status,
      200,
    );
    assert.deepEqual((await read()).config, desired);
    assert.deepEqual(await preserved(), before);
    assert.deepEqual(await runState(), admitted);
    const current = await getProjectAgent(sql, auth, projectId, agentId);
    assert.ok(current);
    const quiet =
      await sql`SELECT count(*) AS count FROM app.audit_logs WHERE org_id = ${ctx.orgId} AND metadata ->> 'projectAgentId' = ${agentId}`;
    const same = snapshot.parse(await read());
    assert.equal(
      (await request({ config: desired, expectedHash: same.hash })).status,
      200,
    );
    assert.deepEqual(
      await getProjectAgent(sql, auth, projectId, agentId),
      current,
    );
    assert.deepEqual(
      await sql`SELECT count(*) AS count FROM app.audit_logs WHERE org_id = ${ctx.orgId} AND metadata ->> 'projectAgentId' = ${agentId}`,
      quiet,
    );
    assert.equal(
      (await request({ config: desired, expectedHash: initial.hash })).status,
      409,
    );
    await assert.rejects(
      transactSerializable(sql, (tx) =>
        updateProjectAgent(tx, auth, {
          agentId,
          name: current.name,
          harness: current.harness,
          model: current.model,
          modelProvider: current.modelProvider ?? undefined,
          skills: current.skills,
          connectors: current.connectors,
          tools: current.tools,
          secrets: current.secrets,
          instructions: current.instructions ?? undefined,
          expectedUpdatedAt: current.updatedAt - 1,
        }),
      ),
      { code: 'PROJECT_AGENT_STALE' },
    );

    const competing = await Promise.allSettled([
      transactSerializable(sql, (tx) =>
        write(tx, same.hash, { ...desired, model: 'itest-model' }),
      ),
      transactSerializable(sql, (tx) =>
        write(tx, same.hash, { ...desired, model: 'test-model' }),
      ),
    ]);
    assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = competing.find((r) => r.status === 'rejected');
    assert.ok(loser?.status === 'rejected');
    assert.equal(
      z.object({ code: z.string() }).parse(loser.reason).code,
      'CONFIG_VERSION_CONFLICT',
    );
    assert.deepEqual(await preserved(), before);

    // Hold an actual admission's snapshot open across a committed model update.
    // A serialization retry may use the complete new tuple; an older snapshot
    // may admit the complete old tuple. Neither can combine the two.
    const old = snapshot.parse(await read());
    const next = {
      ...desired,
      harness: 'codex',
      model: old.config.model === 'itest-model' ? 'test-model' : 'itest-model',
    };
    const ready = Promise.withResolvers<void>();
    const changed = Promise.withResolvers<void>();
    void ready.promise.catch(() => undefined);
    void changed.promise.catch(() => undefined);
    let attempts = 0;
    const timer = setTimeout(() => {
      ready.reject(new Error('Admission snapshot timeout'));
      changed.reject(new Error('Model update timeout'));
    }, 10_000);
    const admission = transactSerializable(sql, async (tx) => {
      const serving = await getProjectAgent(tx, auth, projectId, agentId);
      assert.ok(serving);
      if (++attempts === 1) {
        ready.resolve();
        await changed.promise;
      }
      const kicked = await kickAgentRun(tx, {
        organizationId: ctx.orgId,
        projectId,
        taskId: taskIds[2],
        agentId,
        harness: serving.harness,
        model: serving.model,
        ...(serving.modelProvider === null
          ? {}
          : { modelProvider: serving.modelProvider }),
        startedBy: ctx.userId,
        sessionId: `pa-${agentId}-fixture-race`,
      });
      const [stamped] = await tx<
        { harness: string; model: string; modelProvider: string | null }[]
      >`
        SELECT harness, model, model_provider AS "modelProvider" FROM app.project_agent_runs WHERE id = ${kicked.runId}`;
      assert.equal(
        await cancelAgentRunInTx(tx, {
          organizationId: ctx.orgId,
          taskId: taskIds[2],
          runId: kicked.runId,
        }),
        true,
      );
      // Remove exactly the native turn and cancellation-cleanup jobs while
      // still uncommitted. No worker can observe either fixture job.
      const removed = await tx<{ name: string }[]>`DELETE FROM pgboss.job
        WHERE name IN ('task.agent_turn', 'task.agent_drive')
          AND data ->> 'organizationId' = ${ctx.orgId}
          AND data ->> 'runId' = ${kicked.runId} RETURNING name`;
      assert.deepEqual(removed.map((row) => row.name).sort(), [
        'task.agent_drive',
        'task.agent_turn',
      ]);
      return stamped;
    });
    const settled = Promise.allSettled([admission]);
    try {
      await ready.promise;
      await transactSerializable(sql, (tx) => write(tx, old.hash, next));
      changed.resolve();
      const [outcome] = await settled;
      assert.ok(outcome?.status === 'fulfilled');
      const tuple = (c: typeof old.config) => ({
        harness: c.harness,
        model: c.model,
        modelProvider: c.modelProvider,
      });
      assert.ok(
        [tuple(old.config), tuple(next)].some(
          (c) => JSON.stringify(c) === JSON.stringify(outcome.value),
        ),
      );
      assert.deepEqual(await runState(), admitted);
      assert.deepEqual(await preserved(), before);
    } finally {
      changed.resolve();
      await settled;
      clearTimeout(timer);
    }
    record(
      'managed agent model: native CAS, next-admission tuple and equipment preservation',
      true,
      `HTTP scope/schema/provider refusals; one CAS winner; quiet no-op; stale full save refused; queued/running tuples unchanged; actual kick cancelled before commit; concurrent admission attempts=${attempts}`,
    );
  } finally {
    await sql`DELETE FROM pgboss.job WHERE name IN ('task.agent_turn', 'task.agent_drive') AND data ->> 'organizationId' = ${ctx.orgId}
      AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs WHERE agent_id = ${agentId} AND org_id = ${ctx.orgId})`;
    await sql`DELETE FROM app.project_agent_runs WHERE agent_id = ${agentId} AND org_id = ${ctx.orgId}`;
    await sql`DELETE FROM app.tasks WHERE id = ANY(${taskIds}) AND org_id = ${ctx.orgId}`;
    await sql`DELETE FROM app.project_agents WHERE id = ${agentId} AND org_id = ${ctx.orgId}`;
  }
}
