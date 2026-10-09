/** Runs inside the existing held-agent review lane. All IDs belong to this
 * fixture; no provider request, sandbox or additional worker is started. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import type { ProjectAuthContext } from '../projects/service.ts';
import { kickAgentRun } from './agent-runs.ts';
import type { Fixtures, Recorder } from './delegated-start.integration.ts';
import {
  readTaskReviewContextConfiguration,
  updateTaskReviewContextConfiguration,
} from './review-context.ts';
import { loadTaskOrThrow } from './service.ts';

export async function checkReviewContextBootstrap(args: {
  sql: Sql;
  base: string;
  cookie: string;
  orgId: string;
  projectId: string;
  reviewerAgentId: string;
  auth: ProjectAuthContext;
  fx: Fixtures;
  record: Recorder;
}): Promise<void> {
  const { sql, orgId, projectId, reviewerAgentId, auth, fx, record } = args;
  const ids: string[] = Array.from({ length: 5 }, () => randomUUID());
  const [taskId, rollbackId, raceId, foreignId, refusedId] = ids;
  assert.ok(taskId && rollbackId && raceId && foreignId && refusedId);
  const configFor = (id: string) => ({
    projectId,
    taskId: id,
    reviewerAgentId,
    enabled: true,
  });
  const write = (id: string, hash: string | null = null, who = auth) =>
    transactSerializable(sql, (tx) =>
      updateTaskReviewContextConfiguration(tx, who, configFor(id), hash, true),
    );
  const read = (id: string) =>
    readTaskReviewContextConfiguration(sql, auth, projectId, id, true);
  const projectState = async () => {
    const [row] = await sql<
      { counter: number; open: number }[]
    >`SELECT task_counter AS counter, open_task_count AS open FROM app.projects WHERE id = ${projectId} AND org_id = ${orgId}`;
    assert.ok(row);
    return row;
  };
  const otherProject = randomUUID();
  const request = (
    id: string,
    body?: unknown,
    cookie = args.cookie,
    create = true,
  ) =>
    fetch(
      `${args.base}/api/app/tasks/${id}/configuration/review-context?orgId=${orgId}&projectId=${projectId}${create && body === undefined ? '&createIfMissing=true' : ''}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          cookie,
          origin: args.base,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  try {
    const before = await projectState();
    const absent = await request(taskId);
    assert.equal(absent.status, 200);
    assert.deepEqual(await absent.json(), { config: null, hash: null });
    assert.equal((await request(taskId, undefined, '')).status, 401);
    assert.equal(
      (await request(taskId, undefined, args.cookie, false)).status,
      404,
    );
    assert.equal(
      (
        await request(refusedId, {
          config: configFor(refusedId),
          expectedHash: null,
          createIfMissing: false,
        })
      ).status,
      400,
    );
    assert.deepEqual(await read(taskId), { config: null, hash: null });
    await assert.rejects(
      readTaskReviewContextConfiguration(sql, auth, projectId, taskId),
      { code: 'TASK_NOT_FOUND' },
    );
    await assert.rejects(
      write(refusedId, null, {
        ...auth,
        role: 'member',
        userId: `not-owner-${fx.suffix}`,
      }),
      { code: 'RBAC_FORBIDDEN' },
    );
    await assert.rejects(write(refusedId, '0'.repeat(64)), {
      code: 'CONFIG_VERSION_CONFLICT',
    });
    assert.deepEqual(await projectState(), before);
    assert.deepEqual(await read(refusedId), { config: null, hash: null });
    record(
      'review context bootstrap: explicit opt-in and editor/CAS refusals leave no task',
      true,
      '',
    );

    // Fail after the maintained creator has written counters/activity/audit;
    // missing task_review must roll the entire transaction back.
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_get']::text[] WHERE id = ${reviewerAgentId} AND org_id = ${orgId}`;
    await assert.rejects(write(rollbackId), { code: 'TASK_REVIEW_FORBIDDEN' });
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review','task_get']::text[] WHERE id = ${reviewerAgentId} AND org_id = ${orgId}`;
    assert.deepEqual(await read(rollbackId), { config: null, hash: null });
    assert.deepEqual(await projectState(), before);
    const rollbackRows = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM app.audit_logs WHERE org_id = ${orgId} AND resource_id = ${rollbackId}`;
    assert.equal(rollbackRows[0]?.n, 0);
    record(
      'review context bootstrap: failed enrollment rolls back creation and native metadata',
      true,
      '',
    );

    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const creation = transactSerializable(sql, async (tx) => {
      await updateTaskReviewContextConfiguration(
        tx,
        auth,
        configFor(taskId),
        null,
        true,
      );
      ready.resolve();
      await release.promise;
    });
    const settled = Promise.allSettled([creation]);
    const timer = setTimeout(() => {
      ready.reject(new Error('Bootstrap barrier expired'));
      release.resolve();
    }, 10_000);
    try {
      await ready.promise;
      assert.deepEqual(await read(taskId), { config: null, hash: null });
      await assert.rejects(loadTaskOrThrow(sql, taskId, orgId), {
        code: 'TASK_NOT_FOUND',
      });
    } finally {
      release.resolve();
      clearTimeout(timer);
      // Even a failed visibility assertion must finish the owned transaction
      // before the outer finally removes its rows.
      await settled;
    }
    const [created] = await settled;
    assert.equal(created?.status, 'fulfilled');
    const current = await read(taskId);
    assert.deepEqual(current.config, configFor(taskId));
    assert.ok(current.hash);
    const [row] = await sql<
      { number: number; marked: boolean; status: string; assignee: string }[]
    >`SELECT number, review_context AS marked, status, assignee_id AS assignee FROM app.tasks WHERE id = ${taskId} AND org_id = ${orgId}`;
    assert.equal(row?.number, before.counter + 1);
    assert.equal(row?.marked, true);
    assert.equal(row?.status, 'backlog');
    assert.equal(row?.assignee, reviewerAgentId);
    assert.deepEqual(await projectState(), {
      counter: before.counter + 1,
      open: before.open + 1,
    });
    const audit = await sql<
      { action: string }[]
    >`SELECT action FROM app.audit_logs WHERE org_id = ${orgId} AND resource_id = ${taskId} ORDER BY action`;
    assert.deepEqual(
      audit.map((entry) => entry.action),
      ['task.created', 'task.review_context_configured'],
    );
    record(
      'review context bootstrap: task and context become visible together with native numbering and audit',
      true,
      '',
    );

    const snapshot =
      await sql`SELECT to_jsonb(t) AS row FROM app.tasks t WHERE id = ${taskId}`;
    assert.equal(
      (
        await request(taskId, {
          config: configFor(taskId),
          expectedHash: current.hash,
          createIfMissing: true,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      await sql`SELECT to_jsonb(t) AS row FROM app.tasks t WHERE id = ${taskId}`,
      snapshot,
    );
    assert.deepEqual(
      await sql`SELECT action FROM app.audit_logs WHERE org_id = ${orgId} AND resource_id = ${taskId} ORDER BY action`,
      audit,
    );
    await assert.rejects(write(taskId), { code: 'CONFIG_VERSION_CONFLICT' });
    await assert.rejects(
      transactSerializable(sql, (tx) =>
        kickAgentRun(tx, {
          organizationId: orgId,
          projectId,
          taskId,
          agentId: reviewerAgentId,
          harness: 'claude-code',
          model: 'itest-model',
          startedBy: auth.userId,
        }),
      ),
      {
        code: '23514',
        message: 'An enrolled context requires its exact native review batch',
      },
    );
    const runs = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM app.project_agent_runs WHERE org_id = ${orgId} AND task_id = ${taskId}`;
    assert.equal(runs[0]?.n, 0);
    record(
      'review context bootstrap: lost-response retry is a no-op and ordinary agent admission refuses',
      true,
      '',
    );

    const concurrent = await Promise.allSettled([write(raceId), write(raceId)]);
    assert.equal(
      concurrent.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const loser = concurrent.find((result) => result.status === 'rejected');
    assert.equal(
      loser?.status === 'rejected' &&
        typeof loser.reason === 'object' &&
        loser.reason !== null &&
        'code' in loser.reason
        ? loser.reason.code
        : null,
      'CONFIG_VERSION_CONFLICT',
    );
    assert.deepEqual((await read(raceId)).config, configFor(raceId));
    assert.deepEqual(await projectState(), {
      counter: before.counter + 2,
      open: before.open + 2,
    });
    record(
      'review context bootstrap: competing creates commit one identity and one counter transition',
      true,
      '',
    );

    await fx.insertProject(otherProject, 'Bootstrap foreign scope');
    await sql`INSERT INTO app.tasks (id, org_id, project_id, title, status, rank, created_by, created_by_type, created_at_ms, updated_at_ms) VALUES (${foreignId}, ${`foreign-${fx.suffix}`}, ${otherProject}, 'Foreign identity', 'todo', 'a0', ${auth.userId}, 'user', ${fx.now}, ${fx.now})`;
    await assert.rejects(write(foreignId), { code: 'TASK_REVIEW_INVALID' });
    const [foreign] = await sql<
      { org: string; marked: boolean }[]
    >`SELECT org_id AS org, review_context AS marked FROM app.tasks WHERE id = ${foreignId}`;
    assert.equal(foreign?.org, `foreign-${fx.suffix}`);
    assert.equal(foreign?.marked, false);
    const ordinary = await fx.insertTask({
      projectId,
      title: 'Existing implementation',
      status: 'in_review',
    });
    ids.push(ordinary);
    await assert.rejects(write(ordinary), { code: 'TASK_REVIEW_INVALID' });
    record(
      'review context bootstrap: occupied foreign identities and existing source work remain untouched',
      true,
      '',
    );
  } finally {
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review','task_get']::text[] WHERE id = ${reviewerAgentId} AND org_id = ${orgId}`;
    await sql`DELETE FROM app.task_review_contexts WHERE org_id = ${orgId} AND task_id = ANY(${ids})`;
    await sql`DELETE FROM app.tasks WHERE id = ANY(${ids}) AND org_id IN (${orgId}, ${`foreign-${fx.suffix}`})`;
    await sql`DELETE FROM app.projects WHERE id = ${otherProject} AND org_id = ${orgId}`;
  }
}
