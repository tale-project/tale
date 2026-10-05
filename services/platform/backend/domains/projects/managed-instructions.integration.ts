/** Real PostgreSQL and authenticated HTTP proof for adopted text resources.
 * Uses synthetic project/agent/task fixtures from the existing project lane. */
import assert from 'node:assert/strict';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  readTaskInstructionsConfiguration,
  updateTaskInstructionsConfiguration,
} from '../tasks/service.ts';
import {
  readProjectInstructionsConfiguration,
  readAgentInstructionsConfiguration,
  updateProjectInstructions,
  updateAgentInstructionsConfiguration,
} from './service.ts';

export async function checkManagedInstructions(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  ids: { projectId: string; agentId: string; taskId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const auth = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const { projectId, agentId, taskId } = ids;
  const resources = [
    {
      kind: 'project',
      path: `/api/app/projects/${projectId}/configuration/instructions?orgId=${ctx.orgId}`,
      field: 'instructions',
      read: (tx: Sql | TransactionSql) =>
        readProjectInstructionsConfiguration(tx, auth, projectId),
      write: (tx: TransactionSql, text: string, hash: string) =>
        updateProjectInstructions(tx, auth, projectId, text, hash),
    },
    {
      kind: 'agent',
      path: `/api/app/projects/${projectId}/agents/${agentId}/configuration/instructions?orgId=${ctx.orgId}`,
      field: 'instructions',
      read: (tx: Sql | TransactionSql) =>
        readAgentInstructionsConfiguration(tx, auth, projectId, agentId),
      write: (tx: TransactionSql, text: string, hash: string) =>
        updateAgentInstructionsConfiguration(
          tx,
          auth,
          { projectId, agentId, instructions: text },
          hash,
        ),
    },
    {
      kind: 'task',
      path: `/api/app/tasks/${taskId}/configuration/instructions?orgId=${ctx.orgId}&projectId=${projectId}`,
      field: 'description',
      read: (tx: Sql | TransactionSql) =>
        readTaskInstructionsConfiguration(tx, auth, projectId, taskId),
      write: (tx: TransactionSql, text: string, hash: string) =>
        updateTaskInstructionsConfiguration(
          tx,
          auth,
          { projectId, taskId, description: text },
          hash,
        ),
    },
  ];
  const snapshotSchema = z.strictObject({
    config: z.record(z.string(), z.string()),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  });
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        cookie: ctx.cookie,
        origin: base,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const stableFields = async () => {
    const [project] =
      await sql`SELECT to_jsonb(p) - 'instructions' - 'updated_at_ms' AS fields FROM app.projects p WHERE id = ${projectId}`;
    const [agent] =
      await sql`SELECT to_jsonb(a) - 'instructions' - 'updated_at_ms' AS fields FROM app.project_agents a WHERE id = ${agentId}`;
    const [task] =
      await sql`SELECT to_jsonb(t) - 'description' - 'updated_at_ms' AS fields FROM app.tasks t WHERE id = ${taskId}`;
    return {
      project: project?.fields,
      agent: agent?.fields,
      task: task?.fields,
    };
  };
  const before = await stableFields();
  for (const resource of resources) {
    const response = await fetch(`${base}${resource.path}`, {
      headers: { cookie: ctx.cookie },
    });
    assert.equal(response.status, 200);
    const initial = snapshotSchema.parse(await response.json());
    assert.deepEqual(initial, await resource.read(sql));
    assert.equal(JSON.stringify(initial).includes('secrets'), false);
    assert.equal(
      (await post(resource.path, { config: initial.config })).status,
      400,
    );
    assert.equal(
      (await post(resource.path, { ...initial, expectedHash: initial.hash }))
        .status,
      400,
    );
    const mismatch = await post(resource.path, {
      config: { ...initial.config, projectId: 'other-project' },
      expectedHash: initial.hash,
    });
    assert.equal(mismatch.status, 400);
    const stale = await post(resource.path, {
      config: { ...initial.config, [resource.field]: 'refused' },
      expectedHash: '0'.repeat(64),
    });
    assert.equal(stale.status, 409);
    assert.equal(
      z.object({ error: z.string() }).parse(await stale.json()).error,
      'CONFIG_VERSION_CONFLICT',
    );
    assert.deepEqual(await resource.read(sql), initial);

    // Force first attempts to establish the same PG snapshot. Serialization
    // retries must re-read the row and refuse the losing reviewed preimage.
    const gate = Promise.withResolvers<void>();
    const attempts = [0, 0];
    let arrived = 0;
    const timer = setTimeout(
      () => gate.reject(new Error('Managed instructions race gate timed out')),
      10_000,
    );
    let outcomes: PromiseSettledResult<void>[];
    try {
      outcomes = await Promise.allSettled(
        ['left', 'right'].map((text, index) =>
          transactSerializable(sql, async (tx) => {
            attempts[index] += 1;
            if (attempts[index] === 1) {
              await resource.read(tx);
              if (++arrived === 2) gate.resolve();
              await gate.promise;
            }
            await resource.write(tx, `${resource.kind}-${text}`, initial.hash);
          }),
        ),
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(
      outcomes.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejected = outcomes.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.equal(
      z.object({ code: z.string() }).parse(rejected.reason).code,
      'CONFIG_VERSION_CONFLICT',
    );
    const winner = snapshotSchema.parse(await resource.read(sql));
    assert.ok(
      [`${resource.kind}-left`, `${resource.kind}-right`].includes(
        winner.config[resource.field] ?? '',
      ),
    );
    const stamps = async () => {
      const [row] = await sql`SELECT
        (SELECT updated_at_ms FROM app.projects WHERE id = ${projectId}) AS project,
        (SELECT updated_at_ms FROM app.project_agents WHERE id = ${agentId}) AS agent,
        (SELECT updated_at_ms FROM app.tasks WHERE id = ${taskId}) AS task,
        (SELECT count(*) FROM app.audit_logs WHERE org_id = ${ctx.orgId}) AS audits,
        (SELECT count(*) FROM app.task_activity WHERE task_id = ${taskId}) AS activities`;
      return row;
    };
    const noOpBefore = await stamps();
    assert.equal(
      (
        await post(resource.path, {
          config: winner.config,
          expectedHash: winner.hash,
        })
      ).status,
      200,
    );
    assert.deepEqual(await stamps(), noOpBefore);
    assert.deepEqual(await stableFields(), before);
    record(
      `managed ${resource.kind} instructions: native read/CAS/no-op`,
      true,
      `two concurrent transactions: one persisted value, one conflict; attempts=${attempts.join(',')}; no-op retains timestamps/audit; unrelated fields unchanged`,
    );
  }
}
