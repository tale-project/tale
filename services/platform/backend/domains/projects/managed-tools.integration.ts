/** Real PostgreSQL and the authenticated native door for tools-only adoption.
 * The cloned synthetic agent never starts work and owns no live credential. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import { configurationHashSchema } from '@tale/shared/schemas/configuration';
import { managedAgentToolsSchema } from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  getProjectAgent,
  readAgentToolsConfiguration,
  updateAgentToolsConfiguration,
  updateProjectAgent,
  type ProjectAgentRow,
} from './service.ts';

export async function checkManagedAgentTools(
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
  const projectId = ids.projectId;
  const agentId = randomUUID();
  const futureRevision = Date.now() + 86_400_000;
  await sql`
    INSERT INTO app.project_agents (
      id, org_id, project_id, name, harness, model, model_provider,
      skills, connectors, tools, secrets, instructions, managed, created_by,
      created_at_ms, updated_at_ms
    ) SELECT ${agentId}, org_id, project_id, 'Managed tool fixture', harness,
      model, model_provider, skills, connectors, ARRAY['task_get']::text[],
      secrets, instructions, false, created_by, created_at_ms, ${futureRevision}
    FROM app.project_agents WHERE id = ${ids.agentId}
      AND project_id = ${projectId} AND org_id = ${ctx.orgId}
  `;
  const path = `/api/app/projects/${projectId}/agents/${agentId}/configuration/tools?orgId=${ctx.orgId}`;
  const snapshotSchema = z.strictObject({
    config: managedAgentToolsSchema,
    hash: configurationHashSchema,
  });
  const request = (body?: unknown, cookie = ctx.cookie) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  const read = (tx: Sql | TransactionSql = sql) =>
    readAgentToolsConfiguration(tx, auth, projectId, agentId);
  const write = (tx: TransactionSql, tools: string[], hash: string) =>
    updateAgentToolsConfiguration(
      tx,
      auth,
      { projectId, agentId, tools },
      hash,
    );
  const stableFields = async () => {
    const [row] = await sql`
      SELECT to_jsonb(a) - 'tools' - 'updated_at_ms' AS fields
      FROM app.project_agents a WHERE id = ${agentId}
    `;
    return row?.fields;
  };
  const stamps = async () => {
    const [row] = await sql`SELECT
      (SELECT updated_at_ms FROM app.project_agents WHERE id = ${agentId}) AS revision,
      (SELECT count(*) FROM app.audit_logs WHERE org_id = ${ctx.orgId}) AS audits`;
    return row;
  };
  const fullSave = (
    tx: TransactionSql,
    before: ProjectAgentRow,
    instructions: string,
  ) =>
    updateProjectAgent(tx, auth, {
      agentId,
      name: before.name,
      harness: before.harness,
      model: before.model,
      modelProvider: before.modelProvider ?? undefined,
      skills: before.skills,
      connectors: before.connectors,
      tools: before.tools,
      secrets: before.secrets,
      instructions,
      expectedUpdatedAt: before.updatedAt,
    });

  try {
    const initialResponse = await request();
    assert.equal(initialResponse.status, 200);
    const initial = snapshotSchema.parse(await initialResponse.json());
    assert.deepEqual(initial, await read());
    assert.equal(JSON.stringify(initial).includes('secrets'), false);
    assert.equal((await request(undefined, '')).status, 401);
    const stable = await stableFields();
    for (const body of [
      { config: initial.config },
      {
        config: { ...initial.config, agentId: 'another-agent' },
        expectedHash: initial.hash,
      },
      {
        config: { ...initial.config, projectId: 'another-project' },
        expectedHash: initial.hash,
      },
      {
        config: { ...initial.config, tools: ['unknown_tool'] },
        expectedHash: initial.hash,
      },
      {
        config: { ...initial.config, secrets: [] },
        expectedHash: initial.hash,
      },
      {
        config: { ...initial.config, model: 'replace' },
        expectedHash: initial.hash,
      },
    ])
      assert.equal((await request(body)).status, 400);
    assert.equal(
      (await request({ config: initial.config, expectedHash: '0'.repeat(64) }))
        .status,
      409,
    );
    assert.deepEqual(await read(), initial);
    assert.deepEqual(await stableFields(), stable);

    const gate = Promise.withResolvers<void>();
    // Readers can fail before reaching the barrier; retain the timeout refusal
    // without allowing an unobserved rejection while every reader settles.
    void gate.promise.catch(() => undefined);
    let arrived = 0;
    const attempts = [0, 0];
    const timer = setTimeout(
      () => gate.reject(new Error('Tools CAS race timed out')),
      10_000,
    );
    let outcomes: PromiseSettledResult<void>[];
    try {
      outcomes = await Promise.allSettled(
        [
          ['task_get', 'task_review'],
          ['task_find', 'task_get'],
        ].map((tools, index) =>
          transactSerializable(sql, async (tx) => {
            attempts[index] += 1;
            if (attempts[index] === 1) {
              await read(tx);
              if (++arrived === 2) gate.resolve();
              await gate.promise;
            }
            await write(tx, tools, initial.hash);
          }),
        ),
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    );
    const loser = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(loser?.status === 'rejected');
    assert.equal(
      z.object({ code: z.string() }).parse(loser.reason).code,
      'CONFIG_VERSION_CONFLICT',
    );
    assert.deepEqual(await stableFields(), stable);
    const winner = snapshotSchema.parse(await read());
    const current = await getProjectAgent(sql, auth, projectId, agentId);
    assert.ok(current);
    assert.equal(current.updatedAt, futureRevision + 1);
    const quiet = await stamps();
    assert.equal(
      (
        await request({
          config: {
            ...winner.config,
            tools: [...winner.config.tools]
              .reverse()
              .concat(winner.config.tools),
          },
          expectedHash: winner.hash,
        })
      ).status,
      200,
    );
    assert.deepEqual(await stamps(), quiet);
    await assert.rejects(
      transactSerializable(sql, (tx) =>
        fullSave(tx, { ...current, updatedAt: futureRevision }, 'stale'),
      ),
      { code: 'PROJECT_AGENT_STALE' },
    );
    assert.deepEqual(await stamps(), quiet);

    // Hold the second writer's first snapshot open until the first commits.
    // Retrying serialization must honor both native precondition dialects.
    const orderedRace = async (
      first: (tx: TransactionSql) => Promise<unknown>,
      second: (tx: TransactionSql) => Promise<unknown>,
    ) => {
      const ready = Promise.withResolvers<void>();
      const committed = Promise.withResolvers<void>();
      void ready.promise.catch(() => undefined);
      void committed.promise.catch(() => undefined);
      let tries = 0;
      const timeout = setTimeout(() => {
        ready.reject(new Error('Full-save race did not take its snapshot'));
        committed.reject(new Error('Full-save race did not commit'));
      }, 10_000);
      const delayed = transactSerializable(sql, async (tx) => {
        if (++tries === 1) {
          await read(tx);
          ready.resolve();
          await committed.promise;
        }
        return second(tx);
      });
      // Attach rejection handling immediately; the caller inspects the result.
      const settled = Promise.allSettled([delayed]);
      try {
        await ready.promise;
        await transactSerializable(sql, first);
        committed.resolve();
        const [outcome] = await settled;
        assert.ok(outcome);
        return outcome;
      } finally {
        committed.resolve();
        await settled;
        clearTimeout(timeout);
      }
    };

    const beforeToolsWin = await getProjectAgent(sql, auth, projectId, agentId);
    assert.ok(beforeToolsWin);
    const staleFull = await orderedRace(
      (tx) => write(tx, [], winner.hash),
      (tx) => fullSave(tx, beforeToolsWin, 'must not overwrite tools'),
    );
    assert.equal(staleFull.status, 'rejected');
    assert.ok(staleFull.status === 'rejected');
    assert.equal(
      z.object({ code: z.string() }).parse(staleFull.reason).code,
      'PROJECT_AGENT_STALE',
    );
    assert.deepEqual((await read()).config.tools, []);
    assert.deepEqual(await stableFields(), stable);

    const beforeFullWin = await getProjectAgent(sql, auth, projectId, agentId);
    assert.ok(beforeFullWin);
    const empty = snapshotSchema.parse(await read());
    const retainedEdit = 'Concurrent full save retains this instruction';
    const toolsAfterFull = await orderedRace(
      (tx) => fullSave(tx, beforeFullWin, retainedEdit),
      (tx) => write(tx, ['task_get', 'task_review'], empty.hash),
    );
    assert.equal(toolsAfterFull.status, 'fulfilled');
    const afterFullWin = await getProjectAgent(sql, auth, projectId, agentId);
    assert.ok(afterFullWin);
    assert.equal(afterFullWin.instructions, retainedEdit);
    assert.deepEqual(afterFullWin.tools, ['task_get', 'task_review']);
    assert.equal(afterFullWin.updatedAt, beforeFullWin.updatedAt + 2);
    assert.deepEqual(await stableFields(), {
      ...stable,
      instructions: retainedEdit,
    });

    // Unavailable equipment and a dangling synthetic secret name must remain
    // byte-for-byte even when an editor changes only tool grants.
    await sql`UPDATE app.project_agents SET
      secrets = ARRAY['UNAVAILABLE_SYNTHETIC_SECRET']::text[],
      skills = ARRAY['unavailable-synthetic-skill']::text[],
      connectors = ARRAY['unavailable-synthetic-connector']::text[]
      WHERE id = ${agentId}`;
    const unavailable = await stableFields();
    const beforeEditor = snapshotSchema.parse(await read());
    await transactSerializable(sql, (tx) =>
      updateAgentToolsConfiguration(
        tx,
        { ...auth, role: 'editor' },
        { projectId, agentId, tools: ['task_get'] },
        beforeEditor.hash,
      ),
    );
    assert.deepEqual(await stableFields(), unavailable);
    const memberView = snapshotSchema.parse(
      await readAgentToolsConfiguration(
        sql,
        { ...auth, role: 'member' },
        projectId,
        agentId,
      ),
    );
    await assert.rejects(
      transactSerializable(sql, (tx) =>
        updateAgentToolsConfiguration(
          tx,
          { ...auth, role: 'member' },
          memberView.config,
          memberView.hash,
        ),
      ),
      { code: 'RBAC_FORBIDDEN' },
    );
    // A newer runtime's stored grant must never be silently removed by an
    // older catalog during either discovery or a tools-only write.
    await sql`UPDATE app.project_agents SET tools = ARRAY['future_unknown_tool']::text[]
      WHERE id = ${agentId} AND org_id = ${ctx.orgId}`;
    const unknownBefore = await stamps();
    await assert.rejects(read(), { code: 'PROJECT_AGENT_TOOL_UNKNOWN' });
    assert.equal((await request()).status, 400);
    await assert.rejects(
      transactSerializable(sql, (tx) =>
        write(tx, ['task_get'], memberView.hash),
      ),
      { code: 'PROJECT_AGENT_TOOL_UNKNOWN' },
    );
    const [unknownAfter] =
      await sql`SELECT tools FROM app.project_agents WHERE id = ${agentId}`;
    assert.deepEqual(unknownAfter?.tools, ['future_unknown_tool']);
    assert.deepEqual(await stamps(), unknownBefore);
    assert.deepEqual(await stableFields(), unavailable);
    record(
      'managed agent tools: native CAS, full-save races and exact field preservation',
      true,
      `HTTP identity/schema/hash refusals; competing tool writes one winner; attempts=${attempts.join(',')}; full-save races in both orders; quiet canonical no-op; editor preserves unavailable grants; member read-only; stored unknown grant refuses read/write`,
    );
  } finally {
    await sql`DELETE FROM app.project_agents WHERE id = ${agentId} AND org_id = ${ctx.orgId}`;
  }
}
