/** Real Postgres proof that a connector equipped on a project agent runs in
 * its task run for the member who started the run. The Start agent door
 * writes the run's starter. The host's own token writer
 * (`insertTaskTurnSessionToken`, on the task shim) binds the token to the
 * run's exec and names no person. The connectors bridge finds the row by the
 * bearer's hash, reads the live run's starter and runs a real connector
 * action for that member. A member who left, a run that ended, and a run
 * whose starter names no member are refused with what to do, and the status
 * listing says the same. */
import { createHash, randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { insertTaskTurnSessionToken } from '../../core/tasks/agent_run_host.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { kickAgentRun } from '../tasks/agent-runs.ts';
import {
  agentTurnShimHandlers,
  taskAgentShimScheduler,
} from '../tasks/agent-turn-shim.ts';
import { startTaskAgentRunManual } from '../tasks/service.ts';

interface KickedRun {
  id: string;
  sessionId: string;
  execId: string;
  startedBy: string;
}

interface BridgeBody {
  status?: string;
  output?: unknown;
  blockers?: Array<{ code?: string; guidance?: string }>;
  connectors?: Array<{
    slug?: string;
    usable?: boolean;
    blockers?: Array<{ code?: string }>;
  }>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function checkTaskRunConnectorCaller(
  sql: Sql,
  base: string,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const starterId = randomUUID();
  const projectId = randomUUID();
  const agentId = randomUUID();
  const memberTaskId = randomUUID();
  const systemTaskId = randomUUID();
  const memberToken = `vk-itest-caller-member-${suffix}`;
  const systemToken = `vk-itest-caller-system-${suffix}`;

  // The run's starter is a second member, an editor, so the shared session
  // user stays untouched when this member is disabled below.
  await sql`
    INSERT INTO "user" (
      "id", "email", "name", "emailVerified", "createdAt", "updatedAt"
    ) VALUES (
      ${starterId}, ${`itest-starter-${suffix}@bridge.test`}, 'Run Starter',
      true, now(), now()
    )
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${randomUUID()}, ${orgId}, ${starterId}, 'editor', now())
  `;
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, ${`Connector caller ${suffix}`}, ${userId},
      ${now}, ${now})
  `;
  // Equipped the way the Agents tab saves it: the connector slug on the row.
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      connectors, created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'VAT agent', 'claude-code',
      'itest-model', ${['document']}, ${userId}, ${now}, ${now})
  `;
  for (const [taskId, title] of [
    [memberTaskId, 'Check the VAT run'],
    [systemTaskId, 'Check the VAT run on a schedule'],
  ] as const) {
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type, outputs,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, 'todo', ${taskId},
        'agent', ${agentId}, ${userId}, 'user', ${sql.json([])}, ${now}, ${now})
    `;
  }
  const folders = await sql<{ id: string }[]>`
    INSERT INTO app.folders (org_id, name, created_by, created_at_ms)
    VALUES (${orgId}, ${`Caller probe ${suffix}`}, 'itest:bridge-caller', ${now})
    RETURNING id
  `;
  const folderId = folders[0]?.id ?? '';

  /** The newest run of a task. The lane defers its turn job, so the worker
   * never drives it: this lane is the start that mints the token. */
  const newestRun = async (
    tx: TransactionSql,
    taskId: string,
  ): Promise<KickedRun | undefined> => {
    const runs = await tx<KickedRun[]>`
      SELECT id, session_id AS "sessionId", exec_id AS "execId",
             started_by AS "startedBy"
      FROM app.project_agent_runs
      WHERE task_id = ${taskId} ORDER BY started_at_ms DESC LIMIT 1
    `;
    const run = runs[0];
    if (run !== undefined) {
      await tx`
        UPDATE pgboss.job SET start_after = now() + interval '1 day'
        WHERE name = 'task.agent_turn' AND data ->> 'runId' = ${run.id}
      `;
    }
    return run;
  };

  const shim = createCtxShim(agentTurnShimHandlers(sql), {
    scheduler: taskAgentShimScheduler(sql),
  });
  const mintTurnToken = (run: KickedRun, token: string): Promise<void> =>
    insertTaskTurnSessionToken(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused host on the task shim, as the task.agent_turn job runs it
      shim as unknown as Parameters<typeof insertTaskTurnSessionToken>[0],
      {
        organizationId: orgId,
        sessionId: run.sessionId,
        execId: run.execId,
        harness: 'claude-code',
        connectors: ['document'],
        tools: [],
        deadlineAt: Date.now() + 600_000,
        prepared: {
          tokenHash: sha256(token),
          allowedModels: [],
          budgetCents: 0,
        },
      },
    );
  const bridge = async (
    route: 'execute' | 'status',
    token: string,
    body: unknown,
  ): Promise<BridgeBody> => {
    const res = await fetch(`${base}/api/connectors/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the bridge's own JSON; every field read below is optional
    return (await res.json()) as BridgeBody;
  };
  const listFolder = {
    slug: 'document',
    operation: 'list',
    args: { folderId },
  };
  const toolCallUsers = async (sessionId: string): Promise<string[]> => {
    const rows = await sql<{ userId: string | null }[]>`
      SELECT user_id AS "userId" FROM app.sandbox_tool_calls
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
        AND tool = 'connector:document.list'
      ORDER BY created_at_ms
    `;
    return rows.map((row) => row.userId ?? 'null');
  };

  try {
    // ---- a member starts the run: the call runs for them ----------------
    const starterAuth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: starterId,
      role: 'editor',
    });
    const memberKick = await sql.begin(async (tx) => {
      const started = await startTaskAgentRunManual(
        tx,
        starterAuth,
        memberTaskId,
      );
      return { started, run: await newestRun(tx, memberTaskId) };
    });
    const memberRun = memberKick.run;
    if (memberRun === undefined) {
      record(
        'connectors bridge: a task run calls its equipped connector for its starter',
        false,
        `the Start agent door kicked no run (${JSON.stringify(memberKick.started)})`,
      );
      return;
    }
    await mintTurnToken(memberRun, memberToken);
    const stored = await sql<{ scope: Record<string, unknown> }[]>`
      SELECT scope FROM app.sandbox_session_tokens
      WHERE token_hash = ${sha256(memberToken)}
    `;
    const scope = stored[0]?.scope ?? {};
    const called = await bridge('execute', memberToken, listFolder);
    const listed = await bridge('status', memberToken, {});
    const audited = await sql<{ actorId: string }[]>`
      SELECT actor_id AS "actorId" FROM app.audit_logs
      WHERE org_id = ${orgId} AND action = 'connector.document.list'
        AND actor_id = ${starterId}
    `;
    const memberCalls = await toolCallUsers(memberRun.sessionId);
    const callerBlockers = (listed.connectors?.[0]?.blockers ?? [])
      .map((blocker) => blocker.code)
      .filter((code) => code === 'no_user_context' || code === 'access_denied');
    record(
      'connectors bridge: a task run calls its equipped connector for its starter',
      memberKick.started.started &&
        memberRun.startedBy === starterId &&
        // The token names the run's exec, never the person.
        JSON.stringify(scope.connectorCaller) ===
          JSON.stringify({ kind: 'task-run', execId: memberRun.execId }) &&
        !JSON.stringify(scope).includes(starterId) &&
        // Never user-keyed: the workspace tools keep the binding's authority.
        !('userId' in scope) &&
        called.status === 'ok' &&
        JSON.stringify(called.output) ===
          JSON.stringify({ count: 0, truncated: false, files: [] }) &&
        memberCalls.length === 1 &&
        memberCalls[0] === starterId &&
        audited.length === 1 &&
        callerBlockers.length === 0,
      `started=${memberKick.started.started} startedBy=${memberRun.startedBy === starterId ? 'the starter' : memberRun.startedBy}, caller=${JSON.stringify(scope.connectorCaller)} userIdKey=${'userId' in scope}, execute=${called.status}${called.blockers ? ` ${JSON.stringify(called.blockers)}` : ''} output=${JSON.stringify(called.output)}, forensic=${memberCalls.map((id) => (id === starterId ? 'starter' : id)).join(',')} (want starter), audit rows for the starter=${audited.length} (want 1), status caller blockers=${callerBlockers.join(',') || 'none'}`,
    );

    // ---- the starter leaves the org mid-run: the next call is refused ---
    await sql`
      UPDATE "member" SET "role" = 'disabled'
      WHERE "organizationId" = ${orgId} AND "userId" = ${starterId}
    `;
    const refused = await bridge('execute', memberToken, listFolder);
    const refusedListing = await bridge('status', memberToken, {});
    const afterRefusal = await toolCallUsers(memberRun.sessionId);
    record(
      'connectors bridge: a starter no longer in the org is not acted for',
      refused.status === 'unavailable' &&
        refused.blockers?.[0]?.code === 'access_denied' &&
        // Start agent answers already_running while the run lives.
        (refused.blockers[0].guidance ?? '').includes('cancel the run') &&
        refusedListing.connectors?.[0]?.usable === false &&
        refusedListing.connectors[0].blockers?.[0]?.code === 'access_denied' &&
        afterRefusal.length === 1,
      `execute=${refused.status} ${JSON.stringify(refused.blockers)}, status=${JSON.stringify(refusedListing.connectors?.[0])}, forensic rows=${afterRefusal.length} (want 1: the refusal ran nothing)`,
    );

    // ---- the run ends: its token acts for nobody, though unexpired -------
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE id = ${memberRun.id}
    `;
    await sql`
      UPDATE "member" SET "role" = 'editor'
      WHERE "organizationId" = ${orgId} AND "userId" = ${starterId}
    `;
    const ended = await bridge('execute', memberToken, listFolder);
    const afterEnded = await toolCallUsers(memberRun.sessionId);
    record(
      'connectors bridge: the token of a task run that ended is refused',
      ended.status === 'unavailable' &&
        ended.blockers?.[0]?.code === 'run_ended' &&
        afterEnded.length === 1,
      `execute=${ended.status} ${JSON.stringify(ended.blockers)}, forensic rows=${afterEnded.length} (want 1: the refusal ran nothing)`,
    );

    // ---- a run no member started: refused, and told what to do ----------
    // No door starts a project-agent run for nobody today. The kick names
    // a trigger here the way a future system door would.
    const systemRun = await sql.begin(async (tx) => {
      await kickAgentRun(tx, {
        organizationId: orgId,
        projectId,
        taskId: systemTaskId,
        agentId,
        harness: 'claude-code',
        model: 'itest-model',
        startedBy: 'trigger:itest-schedule',
      });
      return newestRun(tx, systemTaskId);
    });
    if (systemRun === undefined) {
      record(
        'connectors bridge: a task run no member started is refused with what to do',
        false,
        'the kick wrote no run',
      );
      return;
    }
    await mintTurnToken(systemRun, systemToken);
    const systemScope = await sql<{ scope: Record<string, unknown> }[]>`
      SELECT scope FROM app.sandbox_session_tokens
      WHERE token_hash = ${sha256(systemToken)}
    `;
    // Both runs share the agent's standing session, so the refusal is
    // proven by the session's forensic rows staying as they were.
    const rowsBefore = (await toolCallUsers(systemRun.sessionId)).length;
    const nobody = await bridge('execute', systemToken, listFolder);
    const nobodyListing = await bridge('status', systemToken, {});
    const rowsAfter = (await toolCallUsers(systemRun.sessionId)).length;
    const guidance = nobody.blockers?.[0]?.guidance ?? '';
    record(
      'connectors bridge: a task run no member started is refused with what to do',
      JSON.stringify(systemScope[0]?.scope.connectorCaller) ===
        JSON.stringify({ kind: 'task-run', execId: systemRun.execId }) &&
        nobody.status === 'unavailable' &&
        nobody.blockers?.[0]?.code === 'no_user_context' &&
        guidance.includes('Start agent') &&
        guidance.includes('@mention') &&
        nobodyListing.connectors?.[0]?.usable === false &&
        nobodyListing.connectors[0].blockers?.[0]?.code === 'no_user_context' &&
        rowsAfter === rowsBefore,
      `caller=${JSON.stringify(systemScope[0]?.scope.connectorCaller)}, execute=${nobody.status} ${JSON.stringify(nobody.blockers)}, status=${JSON.stringify(nobodyListing.connectors?.[0])}, forensic rows ${rowsBefore}→${rowsAfter} (want unchanged: the refusal ran nothing)`,
    );
  } finally {
    // Leave nothing a worker could drive, and no token that still works.
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE task_id IN (${memberTaskId}, ${systemTaskId})
        AND status IN ('queued', 'running')
    `;
    await sql`
      UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${Date.now()}
      WHERE token_hash IN (${sha256(memberToken)}, ${sha256(systemToken)})
    `;
    await sql`
      DELETE FROM "member"
      WHERE "organizationId" = ${orgId} AND "userId" = ${starterId}
    `;
    await sql`DELETE FROM "user" WHERE "id" = ${starterId}`;
  }
}
