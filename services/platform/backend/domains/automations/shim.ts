import type { Sql } from 'postgres';

import { ConnectorError } from '../../../lib/connectors/errors.ts';
import { AppError } from '../../../lib/shared/errors/app-error';
import { sessionIdForWorkflowExecution } from '../../core/sandbox/session_naming.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { ShimHandlers, ShimScheduler } from '../../lib/ctx-shim.ts';
import { evaluateApprovalGate } from '../approvals/gate.ts';
import { dismissAgentQuestionNotifications } from '../collab/service.ts';
import {
  listWorkflowFolderFiles,
  runConnectorAction,
} from '../connectors/service.ts';
import { agentTurnShimHandlers } from '../tasks/agent-turn-shim.ts';
import { automationAskShimHandlers } from './ask-shim.ts';
import {
  claimRun,
  continueRun,
  deployedVersion,
  emitRunHint,
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
    // The ask lane's CREATE side, stated here rather than inherited: it is
    // this domain's own contract, not something the sandbox map lends it.
    ...automationAskShimHandlers(sql),

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
      const args = raw as Parameters<typeof evaluateApprovalGate>[1];
      return evaluateApprovalGate(sql, args);
    },

    'connectors/execute_action:runConnectorAction': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper assembles exactly the door's arg shape
      const args = raw as Parameters<typeof runConnectorAction>[1];
      try {
        return await runConnectorAction(sql, args);
      } catch (error) {
        // The 0.4 wire carried coded refusals as AppError data; the
        // stepper branches on `code` — keep that contract.
        if (error instanceof ConnectorError) {
          throw new AppError({
            code: error.code,
            message: error.message,
            connector: error.connector ?? args.connector,
            action: error.action ?? args.action,
            ...(error.hint !== undefined ? { hint: error.hint } : {}),
          });
        }
        throw error;
      }
    },

    // ------------------------------------------- the agent node's run seams
    // A `files` mount of an agent or script node: the hub folder's tree as
    // blob refs the session stages by URL. Text-only documents carry no
    // blob and cannot be staged, so they are not listed — the walk tells
    // the truth about a cut through `truncated`.
    'documents/internal_queries:listFilesByFolderInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        folderId?: string;
        folderPath?: string;
        recursive?: boolean;
      };
      const listing = await listWorkflowFolderFiles(sql, args);
      if (listing === null) return null;
      return {
        files: listing.files.flatMap((file) =>
          file.blobRef === null
            ? []
            : [{ fileId: file.blobRef, name: file.name }],
        ),
        truncated: listing.truncated,
      };
    },
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

    'automations/queries:loadLiveAgentOpForRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      // The run's latest STILL-RUNNING workflow-agent op. A kick creates this
      // op row BEFORE it schedules the turn start and BEFORE the run's cursor
      // is persisted, so a `running` op is the durable evidence that a turn is
      // in flight even when a crash lost the cursor — the stepper adopts it
      // rather than kicking a SECOND turn (the double-spend guard). Terminal
      // ops (a settled prior node) are not returned. Provider/model split off
      // the op's `<provider>/<gatewayModel>` ref (the slug never has a slash).
      const rows = await sql<
        {
          execId: string;
          sessionId: string;
          modelRef: string | null;
          deadlineMs: number | null;
        }[]
      >`
        SELECT exec_id AS "execId", session_id AS "sessionId",
               model_ref AS "modelRef", deadline_ms::float8 AS "deadlineMs"
        FROM app.sandbox_session_ops
        WHERE org_id = ${args.organizationId}
          AND session_id = ${sessionIdForWorkflowExecution(args.runId)}
          AND kind = 'workflow-agent' AND status = 'running'
        ORDER BY started_at_ms DESC, id DESC
        LIMIT 1
      `;
      const op = rows[0];
      if (!op) return null;
      const modelRef = op.modelRef ?? '';
      const slash = modelRef.indexOf('/');
      return {
        execId: op.execId,
        sessionId: op.sessionId,
        deadlineAt: op.deadlineMs ?? 0,
        providerSlug: slash > 0 ? modelRef.slice(0, slash) : '',
        gatewayModel: slash > 0 ? modelRef.slice(slash + 1) : modelRef,
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
        // The agent result just landed in the cursor — nudge open run views.
        await emitRunHint(tx, args.organizationId, args.runId);
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
    // The CREATE side (`createAskForExec`) lives in `ask-shim.ts` and is
    // spread below — the sandbox tool dispatch registers the same handler.
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
      const closed = await sql<{ orgId: string }[]>`
        UPDATE app.automation_human_asks SET status = ${args.status}
        WHERE id = ${args.askId} AND status = 'pending'
        RETURNING org_id AS "orgId"
      `;
      if (closed[0]) {
        await dismissAgentQuestionNotifications(sql, {
          organizationId: closed[0].orgId,
          askId: args.askId,
        }).catch((error: unknown) => {
          console.warn('[asks] bell dismissal failed:', error);
        });
      }
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

    'automations/human_asks:getAskForResume': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { askId: string; organizationId: string };
      const rows = await sql<
        {
          _id: string;
          runId: string;
          nodeId: string;
          execId: string;
          question: string;
          expiresAt: number;
          status: string;
          agentSessionId: string | null;
          answer: string | null;
        }[]
      >`
        SELECT id AS "_id", run_id AS "runId", node_id AS "nodeId",
               exec_id AS "execId", question,
               expires_at_ms::float8 AS "expiresAt", status,
               agent_session_id AS "agentSessionId", answer
        FROM app.automation_human_asks
        WHERE id = ${args.askId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        _id: row._id,
        runId: row.runId,
        nodeId: row.nodeId,
        execId: row.execId,
        question: row.question,
        expiresAt: row.expiresAt,
        status: row.status,
        ...(row.agentSessionId !== null
          ? { agentSessionId: row.agentSessionId }
          : {}),
        ...(row.answer !== null ? { answer: row.answer } : {}),
      };
    },

    'automations/human_asks:retargetAgentCursor': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        runId: string;
        nodeId: string;
        fromExecId: string;
        toExecId?: string;
        deadlineAt?: number;
      };
      // The same guarded patch as `recordAgentTurnSettled`: the run must be
      // live, parked on this node, on the expected exec, with no result — a
      // stale resume retargets nothing. FOR UPDATE serializes racing resumes
      // so exactly one wins the retarget.
      return sql.begin(async (tx) => {
        const rows = await tx<{ status: string; checkpoints: unknown }[]>`
          SELECT status, checkpoints FROM app.automation_runs
          WHERE id = ${args.runId} AND org_id = ${args.organizationId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row || !['waiting', 'running', 'queued'].includes(row.status)) {
          return { retargeted: false };
        }
        const checkpoints =
          row.checkpoints !== null && typeof row.checkpoints === 'object'
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
              (row.checkpoints as {
                nodes?: unknown;
                cursor?: {
                  node?: string;
                  agent?: {
                    execId?: string;
                    result?: unknown;
                    deadlineAt?: number;
                  };
                };
                executions?: unknown;
              })
            : {};
        const cursor = checkpoints.cursor;
        if (
          cursor === undefined ||
          cursor.node !== args.nodeId ||
          cursor.agent === undefined ||
          cursor.agent.execId !== args.fromExecId ||
          cursor.agent.result !== undefined
        ) {
          return { retargeted: false };
        }
        const patched = {
          ...checkpoints,
          cursor: {
            ...cursor,
            agent: {
              ...cursor.agent,
              ...(args.toExecId !== undefined ? { execId: args.toExecId } : {}),
              ...(args.deadlineAt !== undefined
                ? { deadlineAt: args.deadlineAt }
                : {}),
            },
          },
        };
        await tx`
          UPDATE app.automation_runs SET
            checkpoints = ${tx.json(toJson(patched))}
          WHERE id = ${args.runId}
        `;
        return { retargeted: true };
      });
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
  // Scheduled payloads arrive as unknown JSON — narrow each field instead of
  // String() (which would stringify a stray object to '[object Object]').
  const str = (value: unknown): string =>
    typeof value === 'string' ? value : '';
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
    if (functionName === 'automations/agent_host:driveWorkflowAgentTurn') {
      // The turn's self-chain: `continueOrSettle` re-schedules one attach
      // window after every `running` window. Without this mapping the chain
      // dies at the FIRST re-schedule, settling a working turn as failed
      // while the agent keeps going (observed live — the task lane's
      // scheduler seam documents the same trap).
      await addJobInTx(
        sql,
        'automation.agent_drive',
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host builds exactly the drive keys its handler re-validates
        payload as never,
        startAfter,
      );
      return;
    }
    if (
      functionName ===
      'automations/agent_host:resumeWorkflowAgentTurnWithAnswer'
    ) {
      await addJobInTx(
        sql,
        'automation.ask_resume',
        {
          organizationId: str(payload.organizationId),
          askId: str(payload.askId),
        },
        startAfter,
      );
      return;
    }
    if (functionName === 'automations/stepper:stepRun') {
      await addJobInTx(
        sql,
        'automation.step',
        {
          organizationId: str(payload.organizationId),
          runId: str(payload.runId),
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
          organizationId: str(payload.organizationId),
          runId: str(payload.runId),
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
