/** Exact released old SQL bodies; no marker, fence or affected-row reinterpretation. */
import type { Sql } from 'postgres';

import { toJson } from '../../../backend/db/sql.ts';
import type { ShimHandlers } from '../../../backend/lib/ctx-shim.ts';
import { emitRunHint } from './adapter.ts';
import { legacyAgentEvent } from './agent-flow-adapter.ts';
async function addJobInTx(..._args: unknown[]): Promise<void> {
  await legacyAgentEvent('legacy-step-enqueued');
}
async function stopWorkflowSessionSlotsInTx(
  ..._args: unknown[]
): Promise<void> {
  await legacyAgentEvent('slot-release-requested');
}

/**
 * ONE projection for every ask read the agent host consumes through
 * `readAskRow` — which discards any row missing `_id`, `runId`, `nodeId`,
 * `execId`, `question`, `expiresAt` or `status`. The pending read once carried
 * a narrower column list (no runId/execId/status), so the host read every
 * pending ask as malformed: a turn that asked and ended cleanly settled as a
 * completed node instead of parking, the answer route found nothing to
 * resume, and the 7-day expiry never ran. Both reads share this list so the
 * two cannot drift apart again.
 */
interface AskRowRecord {
  _id: string;
  runId: string;
  nodeId: string;
  execId: string;
  question: string;
  expiresAt: number;
  status: string;
  agentSessionId: string | null;
  answer: string | null;
  taskId: string | null;
}

const ASK_ROW_COLUMNS = `
  id AS "_id", run_id AS "runId", node_id AS "nodeId", exec_id AS "execId",
  question, expires_at_ms::float8 AS "expiresAt", status,
  agent_session_id AS "agentSessionId", answer, task_id AS "taskId"
`;

/** The host's `AskRow` shape: optional fields are omitted, never null. */
function askRowOf(row: AskRowRecord): Record<string, unknown> {
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
    ...(row.taskId !== null ? { taskId: row.taskId } : {}),
  };
}
export function legacyAgentSqlHandlers(sql: Sql): ShimHandlers {
  return {
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
          // Late settle after a terminal run: the terminal door already
          // freed the allocation while this op was still running, so its
          // release job found the runtime busy. Now that the op is final,
          // the same release captures a fresh ticket for the idle runtime.
          await stopWorkflowSessionSlotsInTx(tx, {
            organizationId: args.organizationId,
            executionId: args.runId,
            onlyIdle: true,
          });
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
        brokerTokenHash?: string | null;
      };
      return sql.begin(async (tx) => {
        const rows = await tx<
          { status: string; checkpoints: unknown; detail: string | null }[]
        >`
          SELECT status, checkpoints, detail FROM app.automation_runs
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
                  agent?: {
                    execId?: string;
                    result?: unknown;
                    brokerTokenHash?: string;
                  };
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
        const { brokerTokenHash: _previousBrokerTokenHash, ...previousAgent } =
          cursor.agent;
        // A start that waited for sandbox room launched: the run's park
        // says an agent works now, not that it waits for room.
        const waitedForRoom = row.detail === `room:${args.nodeId}`;
        await tx`
          UPDATE app.automation_runs SET
            checkpoints = ${tx.json(
              toJson({
                nodes: checkpoints.nodes ?? {},
                cursor: {
                  ...cursor,
                  agent: {
                    ...previousAgent,
                    launchedAt: args.launchedAt,
                    ...(args.brokerTokenHash != null
                      ? { brokerTokenHash: args.brokerTokenHash }
                      : {}),
                  },
                },
                executions: checkpoints.executions ?? 0,
              }),
            )},
            detail = CASE WHEN detail = ${`room:${args.nodeId}`}
              THEN ${`agent:${args.nodeId}`} ELSE detail END
          WHERE id = ${args.runId}
        `;
        if (waitedForRoom) {
          await emitRunHint(tx, args.organizationId, args.runId);
        }
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
      const rows = await sql<AskRowRecord[]>`
        SELECT ${sql.unsafe(ASK_ROW_COLUMNS)}
        FROM app.automation_human_asks
        WHERE id = ${args.askId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const row = rows[0];
      return row ? askRowOf(row) : null;
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
  };
}
