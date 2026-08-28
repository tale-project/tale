import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { ShimHandlers, ShimScheduler } from '../../lib/convex-shim.ts';
import { agentTurnShimHandlers } from '../tasks/agent-turn-shim.ts';
import {
  claimRun,
  continueRun,
  deployedVersion,
  finishRun,
  heartbeatRun,
  recordProgress,
  suspendRun,
  versionRow,
} from './store.ts';

/**
 * Handler map for the REUSED automation stepper
 * (`convex/automations/stepper.ts` — claim/heartbeat/progress/suspend/
 * continue/finish + the two loads), running the whole run contract over the
 * PG store with pg-boss scheduling. The llm node resolves its serving
 * connector through the same provider/credential seams the chat lane's shim
 * already answers (spread first).
 *
 * Deliberately ABSENT (fail-loud until their domains land): the connector
 * executor (`connectors/execute_action:runConnectorAction` — connector
 * dispatch is retired pending its redesign) and the agent-node hosts.
 * The approval gate allows platform-internal writes and refuses outbound
 * ones with a named reason — outbound effects only exist on connector
 * nodes, which fail earlier anyway.
 */
export function automationShimHandlers(sql: Sql): ShimHandlers {
  return {
    // The task-agent turn shim carries the chat + sandbox handler families
    // (knowledge, entity legs, session ops, gateway bookkeeping) — the
    // automation agent node runs on the same substrate.
    ...agentTurnShimHandlers(sql),

    'automations/mutations:claimRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      return claimRun(sql, args.organizationId, args.runId);
    },
    'automations/mutations:heartbeatRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as {
        organizationId: string;
        runId: string;
        epoch: number;
      };
      return heartbeatRun(sql, args.organizationId, args.runId, args.epoch);
    },
    'automations/mutations:recordProgress': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof recordProgress>[1];
      return recordProgress(sql, args);
    },
    'automations/mutations:suspendRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof suspendRun>[1];
      return suspendRun(sql, args);
    },
    'automations/mutations:continueRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof continueRun>[1];
      return continueRun(sql, args);
    },
    'automations/mutations:finishRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof finishRun>[1];
      return finishRun(sql, args);
    },

    'automations/queries:loadRunForStep': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      const rows = await sql<
        {
          id: string;
          organizationId: string;
          name: string;
          version: number;
          status: string;
          mode: 'mock' | 'live';
          startedBy: string;
          input: unknown;
          checkpoints: unknown;
          startedAt: number;
        }[]
      >`
        SELECT id, org_id AS "organizationId", name, version, status, mode,
               started_by AS "startedBy", input, checkpoints,
               started_at_ms::float8 AS "startedAt"
        FROM app.automation_runs
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const run = rows[0];
      if (!run) return null;
      const version = await versionRow(
        sql,
        args.organizationId,
        run.name,
        run.version,
      );
      if (!version) return null;
      return { run, document: version.document };
    },

    'automations/queries:loadAutomationDocument': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as {
        organizationId: string;
        name: string;
        version?: number;
      };
      const version =
        args.version ??
        (await deployedVersion(sql, args.organizationId, args.name));
      const row = await versionRow(
        sql,
        args.organizationId,
        args.name,
        version,
      );
      return row ? { version: row.version, document: row.document } : null;
    },

    'approvals/gate:evaluateApprovalGate': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper's gate passes exactly this shape
      const args = raw as { platformInternal?: boolean; connector: string };
      if (args.platformInternal === true) {
        return { decision: 'allow' };
      }
      // Outbound live writes wait for the approvals domain; connector nodes
      // fail earlier (the executor is un-shimmed), so this is a backstop.
      throw new Error(
        `[automations] outbound approval for "${args.connector}" needs the approvals domain (not ported yet)`,
      );
    },

    // ------------------------------------------- the agent node's run seams
    'automations/queries:readAgentCursor': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      const rows = await sql<
        { status: string; detail: string | null; checkpoints: unknown }[]
      >`
        SELECT status, detail, checkpoints FROM app.automation_runs
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const checkpoints =
        row.checkpoints !== null && typeof row.checkpoints === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
            (row.checkpoints as { cursor?: unknown })
          : {};
      return {
        status: row.status,
        ...(row.detail !== null ? { detail: row.detail } : {}),
        ...(checkpoints.cursor !== undefined
          ? { cursor: checkpoints.cursor }
          : {}),
      };
    },

    'automations/mutations:recordAgentTurnSettled': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        runId: string;
        nodeId: string;
        execId: string;
        result: unknown;
      };
      return sql.begin(async (tx) => {
        const rows = await tx<{ status: string; checkpoints: unknown }[]>`
          SELECT status, checkpoints FROM app.automation_runs
          WHERE id = ${args.runId} AND org_id = ${args.organizationId}
          LIMIT 1
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) return { recorded: false };
        if (!['waiting', 'running', 'queued'].includes(row.status)) {
          // Late settle after a terminal run: free the run's session now.
          await tx`
            UPDATE app.sandbox_sessions SET status = 'stopped'
            WHERE org_id = ${args.organizationId}
              AND owner_type = 'workflow_run'
              AND (owner_id = ${args.runId}
                   OR owner_id LIKE ${args.runId + ':%'})
              AND status IN ('creating', 'active', 'degraded')
              AND pinned = false
          `;
          return { recorded: false };
        }
        const checkpoints =
          row.checkpoints !== null && typeof row.checkpoints === 'object'
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
              (row.checkpoints as {
                nodes?: Record<string, unknown>;
                cursor?: {
                  node?: string;
                  agent?: { execId?: string; result?: unknown };
                };
                executions?: number;
              })
            : {};
        const cursor = checkpoints.cursor;
        if (
          cursor === undefined ||
          cursor.node !== args.nodeId ||
          cursor.agent === undefined ||
          cursor.agent.execId !== args.execId ||
          cursor.agent.result !== undefined
        ) {
          return { recorded: false };
        }
        await tx`
          UPDATE app.automation_runs SET
            checkpoints = ${tx.json(
              toJson({
                nodes: checkpoints.nodes ?? {},
                cursor: {
                  ...cursor,
                  agent: { ...cursor.agent, result: args.result },
                },
                executions: checkpoints.executions ?? 0,
              }),
            )},
            wake_at_ms = ${Date.now()}
          WHERE id = ${args.runId}
        `;
        await addJobInTx(tx, 'automation.step', {
          organizationId: args.organizationId,
          runId: args.runId,
        });
        return { recorded: true };
      });
    },

    'automations/mutations:stampAgentTurnLaunch': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        runId: string;
        nodeId: string;
        execId: string;
        launchedAt: number;
        brokerTokenHash?: string;
      };
      return sql.begin(async (tx) => {
        const rows = await tx<{ status: string; checkpoints: unknown }[]>`
          SELECT status, checkpoints FROM app.automation_runs
          WHERE id = ${args.runId} AND org_id = ${args.organizationId}
          LIMIT 1
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row || !['waiting', 'running', 'queued'].includes(row.status)) {
          return { stamped: false };
        }
        const checkpoints =
          row.checkpoints !== null && typeof row.checkpoints === 'object'
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
              (row.checkpoints as {
                nodes?: Record<string, unknown>;
                cursor?: {
                  node?: string;
                  agent?: { execId?: string; result?: unknown };
                };
                executions?: number;
              })
            : {};
        const cursor = checkpoints.cursor;
        if (
          cursor === undefined ||
          cursor.node !== args.nodeId ||
          cursor.agent === undefined ||
          cursor.agent.execId !== args.execId ||
          cursor.agent.result !== undefined
        ) {
          return { stamped: false };
        }
        await tx`
          UPDATE app.automation_runs SET
            checkpoints = ${tx.json(
              toJson({
                nodes: checkpoints.nodes ?? {},
                cursor: {
                  ...cursor,
                  agent: {
                    ...cursor.agent,
                    launchedAt: args.launchedAt,
                    ...(args.brokerTokenHash !== undefined
                      ? { brokerTokenHash: args.brokerTokenHash }
                      : {}),
                  },
                },
                executions: checkpoints.executions ?? 0,
              }),
            )}
          WHERE id = ${args.runId}
        `;
        return { stamped: true };
      });
    },

    'automations/queries:getRunProjectId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      const rows = await sql<{ projectId: string | null }[]>`
        SELECT project_id AS "projectId" FROM app.automation_runs
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      return rows[0]?.projectId ?? null;
    },

    'automations/queries:getRunProjectContext': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      const runs = await sql<{ projectId: string | null; name: string }[]>`
        SELECT project_id AS "projectId", name FROM app.automation_runs
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const run = runs[0];
      if (!run) return { project: null, boundProjects: [], bound: false };
      if (run.projectId !== null) {
        const projects = await sql<
          { id: string; name: string; key: string | null }[]
        >`
          SELECT id, name, key FROM app.projects
          WHERE id = ${run.projectId} AND org_id = ${args.organizationId}
          LIMIT 1
        `;
        const project = projects[0];
        return {
          project:
            project !== undefined
              ? {
                  id: project.id,
                  name: project.name,
                  ...(project.key !== null ? { key: project.key } : {}),
                }
              : null,
          boundProjects: [],
          bound: false,
        };
      }
      const bound = await sql<
        { id: string; name: string; key: string | null }[]
      >`
        SELECT p.id, p.name, p.key
        FROM app.automation_project_bindings b
        JOIN app.projects p ON p.id = b.project_id
        WHERE b.org_id = ${args.organizationId}
          AND b.automation_name = ${run.name}
      `;
      return {
        project: null,
        boundProjects: bound.map((project) => ({
          id: project.id,
          name: project.name,
          ...(project.key !== null ? { key: project.key } : {}),
        })),
        bound: bound.length > 0,
      };
    },

    'projects/internal_queries:getProjectSkillScope': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { projectId: string };
      const rows = await sql<{ teamId: string | null; shared: string[] }[]>`
        SELECT team_id AS "teamId", shared_with_team_ids AS shared
        FROM app.projects WHERE id = ${args.projectId} LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const teamIds = new Set<string>();
      if (row.teamId !== null) teamIds.add(row.teamId);
      for (const teamId of row.shared) teamIds.add(teamId);
      return { teamIds: [...teamIds] };
    },

    'sandbox/session_mutations:hibernateAutomationScopedSession': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { executionId: string };
      await sql`
        UPDATE app.sandbox_sessions s SET status = 'stopped'
        WHERE s.owner_type = 'workflow_run'
          AND (s.owner_id = ${args.executionId}
               OR s.owner_id LIKE ${args.executionId + ':%'})
          AND s.status IN ('creating', 'active', 'degraded')
          AND s.pinned = false
          AND NOT EXISTS (
            SELECT 1 FROM app.sandbox_session_ops op
            WHERE op.session_id = s.session_id AND op.status = 'running'
          )
      `;
      return null;
    },

    // ----------------------------------------------------- the ask lane
    'automations/human_asks:createAskForExec': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        question: string;
        questions?: unknown;
      };
      const question = args.question.trim().slice(0, 4000);
      if (question === '') {
        return { refused: 'the question is empty' };
      }
      const sessions = await sql<{ ownerType: string; ownerId: string }[]>`
        SELECT owner_type AS "ownerType", owner_id AS "ownerId"
        FROM app.sandbox_sessions
        WHERE session_id = ${args.sessionId}
          AND org_id = ${args.organizationId}
        ORDER BY created_at_ms DESC
        LIMIT 1
      `;
      const session = sessions[0];
      if (!session || session.ownerType !== 'workflow_run') {
        return { refused: 'this session is not an automation run session' };
      }
      const runId = session.ownerId.split(':')[0] ?? '';
      const runs = await sql<{ status: string; checkpoints: unknown }[]>`
        SELECT status, checkpoints FROM app.automation_runs
        WHERE id = ${runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const run = runs[0];
      if (!run) {
        return { refused: 'the automation run behind this session is gone' };
      }
      if (!['waiting', 'running', 'queued'].includes(run.status)) {
        return { refused: 'the automation run has already finished' };
      }
      const checkpoints =
        run.checkpoints !== null && typeof run.checkpoints === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
            (run.checkpoints as {
              cursor?: {
                node?: string;
                agent?: { execId?: string; result?: unknown };
              };
            })
          : {};
      const agent = checkpoints.cursor?.agent;
      if (agent === undefined || agent.result !== undefined) {
        return { refused: 'the run has no live agent turn right now' };
      }
      const execId = agent.execId ?? '';
      const existing = await sql<{ id: string; question: string }[]>`
        SELECT id, question FROM app.automation_human_asks
        WHERE session_id = ${args.sessionId} AND exec_id = ${execId}
          AND status = 'pending'
        LIMIT 1
      `;
      if (existing[0]) {
        const merged = `${existing[0].question}\n\n---\n\n${question}`.slice(
          0,
          4000,
        );
        await sql`
          UPDATE app.automation_human_asks SET
            question = ${merged}, questions = NULL
          WHERE id = ${existing[0].id}
        `;
        return { askId: existing[0].id, question, folded: true };
      }
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO app.automation_human_asks (
          org_id, run_id, node_id, session_id, exec_id, question, questions,
          status, expires_at_ms, created_at_ms
        ) VALUES (
          ${args.organizationId}, ${runId},
          ${checkpoints.cursor?.node ?? ''}, ${args.sessionId}, ${execId},
          ${question},
          ${args.questions === undefined ? null : sql.json(toJson(args.questions))},
          'pending', ${Date.now() + 7 * 24 * 3_600_000}, ${Date.now()}
        )
        RETURNING id
      `;
      return { askId: inserted[0]?.id ?? '', question, folded: false };
    },

    'automations/human_asks:getPendingAskForExec': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { sessionId: string; execId: string };
      const rows = await sql<
        {
          _id: string;
          nodeId: string;
          question: string;
          expiresAt: number;
          taskId: string | null;
        }[]
      >`
        SELECT id AS "_id", node_id AS "nodeId", question,
               expires_at_ms::float8 AS "expiresAt", task_id AS "taskId"
        FROM app.automation_human_asks
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
          AND status = 'pending'
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        _id: row._id,
        nodeId: row.nodeId,
        question: row.question,
        expiresAt: row.expiresAt,
        ...(row.taskId !== null ? { taskId: row.taskId } : {}),
      };
    },

    'automations/human_asks:closeAsk': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        askId: string;
        status: 'expired' | 'cancelled' | 'answered';
      };
      await sql`
        UPDATE app.automation_human_asks SET status = ${args.status}
        WHERE id = ${args.askId} AND status = 'pending'
      `;
      return null;
    },

    'automations/human_asks:listAnsweredAsksForNode': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        runId: string;
        nodeId: string;
      };
      return sql`
        SELECT question, answer FROM app.automation_human_asks
        WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
          AND node_id = ${args.nodeId} AND status = 'answered'
          AND answer IS NOT NULL
        ORDER BY created_at_ms
      `;
    },

    'automations/human_asks:recordAskParked': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        sessionId: string;
        execId: string;
        agentSessionId?: string;
      };
      await sql`
        UPDATE app.automation_human_asks SET
          agent_session_id = coalesce(${args.agentSessionId ?? null}, agent_session_id)
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
          AND status = 'pending'
      `;
      return null;
    },
  };
}

/** The scheduler seam for the automation shims: the reused hosts' scheduled
 * refs map onto pg-boss jobs (enqueued OUTSIDE any caller tx — best-effort,
 * mirroring the 0.4 scheduler's fire-and-forget posture at these sites). */
export function automationShimScheduler(sql: Sql): ShimScheduler {
  return async (functionName, delayMs, args) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the scheduled refs carry the payloads their handlers re-validate
    const payload = args as Record<string, unknown>;
    const startAfter =
      delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {};
    if (functionName === 'automations/agent_host:startWorkflowAgentTurn') {
      await addJobInTx(
        sql,
        'automation.agent_turn',
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host builds exactly the start args
        payload as never,
        startAfter,
      );
      return;
    }
    if (functionName === 'automations/stepper:stepRun') {
      await addJobInTx(
        sql,
        'automation.step',
        {
          organizationId: String(payload.organizationId ?? ''),
          runId: String(payload.runId ?? ''),
        },
        startAfter,
      );
      return;
    }
    if (functionName === 'automations/mutations:pollParkedRun') {
      await addJobInTx(
        sql,
        'automation.poll',
        {
          organizationId: String(payload.organizationId ?? ''),
          runId: String(payload.runId ?? ''),
          seq: Number(payload.seq ?? 0),
          pollMs: Number(payload.pollMs ?? 1000),
        },
        startAfter,
      );
      return;
    }
    throw new Error(
      `[automations] no job mapping for scheduled function: ${functionName}`,
    );
  };
}
