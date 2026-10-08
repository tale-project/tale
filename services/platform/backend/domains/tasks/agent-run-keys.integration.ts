/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { createTaskList } from '../../jobs/task-list.ts';
import { pgTaskStore } from '../connectors/task-store.ts';
import { resolveSessionOpAttribution } from '../sandbox/op-attribution.ts';
import { failAgentRunFromTurn } from './agent-runs.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';
import {
  fixtures,
  holdAgentJobs,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';

const mintedSchema = z.looseObject({ id: z.string(), key: z.string() });

/** A run's row as this lane reads it. */
interface KeyedRun {
  id: string;
  execId: string;
  sessionId: string;
  status: string;
  trigger: string | null;
  startedBy: string;
  apiKeyId: string | null;
}

/**
 * The API key a project agent's run was started with (`SBX-R14`, migration
 * 0159): a keyed REST comment that names the agent stores the key on the
 * run it starts, and the turn's billing subject carries it; the run's
 * automatic retry carries it on; a turn a steer restarts moves to the
 * steering person's key, or to none; and an agent a keyed automation run
 * puts to work spends under the automation run's key.
 *
 * `ctx` is the suite's owner. The lane makes its own project, agent, key and
 * automation runs, holds every turn its runs queue, and removes them all.
 */
export async function checkAgentRunApiKeys(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix } = fx;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const automation = `itest/run-keys-${suffix}`;
  const release = await holdAgentJobs(sql, suffix, [projectId]);
  let keyId = '';

  const runsOf = (taskId: string) =>
    sql<KeyedRun[]>`
      SELECT id, exec_id AS "execId", session_id AS "sessionId", status,
             trigger, started_by AS "startedBy", api_key_id AS "apiKeyId"
      FROM app.project_agent_runs WHERE task_id = ${taskId} ORDER BY seq
    `;
  const describe = (runs: readonly KeyedRun[]) =>
    runs
      .map(
        (run) =>
          `${run.status}/${run.trigger ?? 'manual'}/key=${run.apiKeyId === null ? 'none' : run.apiKeyId === keyId ? 'the key' : run.apiKeyId}`,
      )
      .join(',') || 'none';

  try {
    await fx.insertProject(projectId, `Run keys ${suffix}`);
    await fx.insertAgent(agentId, projectId, 'Key Runner');
    const minted = mintedSchema.safeParse(
      await (
        await fetch(`${base}/api/auth/api-key/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: ctx.cookie,
            origin: base,
          },
          body: JSON.stringify({ name: `itest-run-keys-${suffix}` }),
        })
      )
        .json()
        .catch(() => null),
    );
    keyId = minted.success ? minted.data.id : '';
    const apiKey = minted.success ? minted.data.key : '';
    const [org] = await sql<{ slug: string }[]>`
      SELECT "slug" FROM "organization" WHERE "id" = ${orgId}
    `;

    // ---- a keyed REST comment that names the agent ----------------------
    const mentioned = await fx.insertTask({
      projectId,
      title: 'Keyed mention',
    });
    const commented = await fetch(
      `${base}/api/v1/projects/${projectId}/tasks/${mentioned}/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'x-organization-slug': org?.slug ?? '',
        },
        body: JSON.stringify({ body: '@key.runner summarize the invoices' }),
      },
    );
    const started = await runsOf(mentioned);
    const first = started[0];
    const subject =
      first !== undefined
        ? await resolveSessionOpAttribution(sql, {
            organizationId: orgId,
            sessionId: first.sessionId,
            execId: first.execId,
            kind: 'task-agent',
          })
        : null;
    record(
      'agent run keys: a keyed comment that names the agent books its run to the key',
      keyId !== '' &&
        commented.status === 201 &&
        started.length === 1 &&
        first?.trigger === 'mention' &&
        first.startedBy === userId &&
        first.apiKeyId === keyId &&
        subject?.userId === userId &&
        subject.agentSlug === agentId &&
        subject.apiKeyId === keyId &&
        subject.projectIds?.join() === projectId,
      `key minted=${keyId !== ''}, comment → ${commented.status} (want 201), runs=${describe(started)} (want queued/mention/key=the key), starter is the owner=${first?.startedBy === userId}, subject=${JSON.stringify({ ...subject, apiKeyId: subject?.apiKeyId === keyId ? 'the key' : subject?.apiKeyId })}`,
    );

    // ---- its automatic retry carries the key ----------------------------
    if (first !== undefined) {
      await failAgentRunFromTurn(sql, {
        runId: first.id,
        execId: first.execId,
        error: 'itest: the harness exited before the turn completed',
        failureCode: 'turn_crashed',
      });
      const armed = await sql<{ data: unknown }[]>`
        SELECT data FROM pgboss.job
        WHERE name = 'task.agent_retry'
          AND data ->> 'expectedRunId' = ${first.id}
      `;
      const retry = createTaskList({ sql })['task.agent_retry'];
      for (const job of armed) await retry?.(job.data);
    }
    const retried = await runsOf(mentioned);
    const second = retried[1];
    record(
      'agent run keys: the automatic retry of a keyed run carries its key',
      retried.length === 2 &&
        second?.trigger === 'auto_retry' &&
        second.startedBy === userId &&
        second.apiKeyId === keyId,
      `runs=${describe(retried)} (want failed/mention/key=the key,queued/auto_retry/key=the key)`,
    );

    // ---- a turn a steer restarts moves to the steerer's key -------------
    const rotate =
      agentTurnShimHandlers(sql)['tasks/agent_runs:rotateTaskAgentRunExec'];
    let steered: Array<KeyedRun | undefined> = [];
    if (second !== undefined && rotate !== undefined) {
      await sql`
        UPDATE app.project_agent_runs SET status = 'running'
        WHERE id = ${second.id}
      `;
      await rotate({
        runId: second.id,
        fromExecId: second.execId,
        startedBy: userId,
      });
      const unkeyed = (await runsOf(mentioned))[1];
      await rotate({
        runId: second.id,
        fromExecId: unkeyed?.execId ?? '',
        startedBy: userId,
        apiKeyId: keyId,
      });
      steered = [unkeyed, (await runsOf(mentioned))[1]];
      await sql`
        UPDATE app.project_agent_runs
        SET status = 'cancelled', settled_at_ms = ${Date.now()}
        WHERE id = ${second.id}
      `;
    }
    record(
      'agent run keys: a turn a steer restarts books to the key the steer was written with, or none',
      steered[0]?.execId === `${second?.execId ?? ''}-2` &&
        steered[0].apiKeyId === null &&
        steered[1]?.execId === `${second?.execId ?? ''}-2-2` &&
        steered[1].apiKeyId === keyId,
      `after an unkeyed steer: key=${steered[0]?.apiKeyId ?? 'none'} (want none); after a keyed one: key=${steered[1]?.apiKeyId === keyId ? 'the key' : (steered[1]?.apiKeyId ?? 'none')} (want the key)`,
    );

    // ---- an agent a keyed automation run puts to work -------------------
    const insertRun = async (key: string | null): Promise<string> => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.automation_runs (org_id, name, version, project_id,
          status, mode, started_by, api_key_id, input, checkpoints,
          started_at_ms)
        VALUES (${orgId}, ${automation}, 1, ${projectId}, 'running', 'live',
          ${`api-key:${userId}`}, ${key}, ${sql.json({})},
          ${sql.json({ nodes: {}, executions: 0 })}, ${Date.now()})
        RETURNING id
      `;
      return rows[0]?.id ?? '';
    };
    const store = pgTaskStore(sql);
    const outcomes: string[] = [];
    const delegated: Array<KeyedRun | undefined> = [];
    for (const key of [keyId, null]) {
      const taskId = await fx.insertTask({
        projectId,
        title: key === null ? 'Unkeyed automation' : 'Keyed automation',
      });
      const outcome = await store
        .startAgent({
          organizationId: orgId,
          caller: {
            kind: 'workflow',
            runId: await insertRun(key),
            nodeId: 'start',
          },
          taskId,
          agentId,
        })
        .then(
          (answer) => (answer.started ? 'started' : 'not started'),
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        );
      outcomes.push(outcome);
      const runs = await runsOf(taskId);
      delegated.push(runs[0]);
      await sql`
        UPDATE app.project_agent_runs
        SET status = 'cancelled', settled_at_ms = ${Date.now()}
        WHERE task_id = ${taskId} AND status IN ('queued', 'running')
      `;
    }
    record(
      'agent run keys: an agent a keyed automation run puts to work spends under its key',
      outcomes.every((outcome) => outcome === 'started') &&
        delegated[0]?.trigger === 'automation' &&
        delegated[0].startedBy === userId &&
        delegated[0].apiKeyId === keyId &&
        delegated[1]?.trigger === 'automation' &&
        delegated[1].apiKeyId === null,
      `answers=${outcomes.join(',')} (want started,started), runs=${describe(delegated.filter((run) => run !== undefined))} (want queued/automation/key=the key,queued/automation/key=none)`,
    );
  } finally {
    await release();
    await sql`
      DELETE FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${automation}
    `;
    await sql`
      DELETE FROM app.user_notifications
      WHERE org_id = ${orgId}
        AND task_id IN (SELECT id FROM app.tasks
                        WHERE project_id = ${projectId})
    `;
    // Cascades to its agent, tasks and runs.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    if (keyId !== '') {
      await fetch(`${base}/api/auth/api-key/delete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ keyId }),
      });
    }
  }
}
