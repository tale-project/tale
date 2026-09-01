import type { Sql } from 'postgres';

import { sessionExecStatus } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { sessionOpLastSignOfLifeMs } from '../../core/sandbox/agent_deadline.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { claimRecoveryResume, RECOVERY_STALE_MS } from '../sandbox/recovery.ts';

/**
 * Re-attach abandoned workflow-agent turns — the 0.5 twin of 0.4's
 * `automations/recover_agent_turns.ts`.
 *
 * A run parked on an `agent` node is driven by a self-chaining job holding a
 * live drain on the exec. When that chain dies mid-turn — a backend restart,
 * an unhandled throw, a lost drive job — NOTHING re-enters the turn: the
 * run's poll chain keeps polling for a settle that nobody will ever write,
 * the liveness sweep keeps the parked run parked (a healthy wait must not be
 * re-stepped), and the agent keeps working inside the sandbox until the
 * turn's wall-clock deadline finally fails a run whose work may have
 * finished long before.
 *
 * The posture is the task lane's, deliberately: **the exec is the source of
 * truth and this never kills a working agent.** Probe first (a transport
 * hiccup must never read as "dead agent"), claim the resume through the
 * sandbox domain's op-row fence (two sweeps cannot both resurrect one turn),
 * and re-attach by enqueueing one drive window — safe by construction, since
 * the drive replays the exec's ring buffer and the settle is claimed exactly
 * once.
 *
 * One exemption the task lane does not need: a turn parked on an `ask_human`
 * question ends its exec ON PURPOSE (terminal op, `awaiting_human`, no
 * cursor result) and may sit that way for days — re-attaching it would
 * settle a question mid-wait, so the listing spares it.
 */

/** Waiting runs examined per sweep (the parked fleet is small — a run only
 * waits while one agent turn is in flight). */
const SCAN_LIMIT = 100;

/** Turns re-attached per sweep. */
const SWEEP_LIMIT = 25;

interface StalledWorkflowTurn {
  organizationId: string;
  runId: string;
  nodeId: string;
  execId: string;
  sessionId: string;
  harness: string;
  providerSlug: string;
  gatewayModel: string;
  deadlineAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parked agent turns nobody is draining any more — the watchdog's work list:
 * runs at `waiting` whose cursor holds an unsettled agent turn and whose op
 * row has gone silent past `staleBeforeMs` (a missing row — a start that
 * died before writing it — counts as silent too). The cursor carries
 * everything a re-attach needs, so recovery never has to reconstruct a
 * turn's identity. Deadline-overdue turns are NOT filtered out: re-attaching
 * one only hands it to the drive window's own deadline cut, which settles it
 * with the real reason.
 */
async function listStalledWorkflowAgentTurns(
  sql: Sql,
  staleBeforeMs: number,
): Promise<StalledWorkflowTurn[]> {
  const rows = await sql<
    {
      runId: string;
      organizationId: string;
      cursor: unknown;
      hasOp: boolean;
      opStatus: string | null;
      agentResultStatus: string | null;
      opStartedAt: number | null;
      opHeartbeatAt: number | null;
      opFinalizedAt: number | null;
      opFinishedAt: number | null;
    }[]
  >`
    SELECT r.id AS "runId", r.org_id AS "organizationId",
           r.checkpoints -> 'cursor' AS cursor,
           (op.id IS NOT NULL) AS "hasOp",
           op.status AS "opStatus",
           op.agent_result_status AS "agentResultStatus",
           op.started_at_ms::float8 AS "opStartedAt",
           op.heartbeat_at_ms::float8 AS "opHeartbeatAt",
           op.finalized_at_ms::float8 AS "opFinalizedAt",
           op.finished_at_ms::float8 AS "opFinishedAt"
    FROM app.automation_runs r
    LEFT JOIN app.sandbox_session_ops op
      ON op.session_id = r.checkpoints -> 'cursor' -> 'agent' ->> 'sessionId'
     AND op.exec_id = r.checkpoints -> 'cursor' -> 'agent' ->> 'execId'
    WHERE r.status = 'waiting'
    ORDER BY r.started_at_ms DESC
    LIMIT ${SCAN_LIMIT}
  `;
  const out: StalledWorkflowTurn[] = [];
  for (const row of rows) {
    if (out.length >= SWEEP_LIMIT) break;
    const cursor = row.cursor;
    if (!isRecord(cursor)) continue;
    const nodeId = cursor.node;
    const agent = cursor.agent;
    if (!isRecord(agent) || typeof nodeId !== 'string') continue;
    // A settled turn is the stepper's to consume, not the watchdog's.
    if (agent.result !== undefined) continue;
    const { execId, sessionId, harness, gatewayModel, deadlineAt } = agent;
    if (
      typeof execId !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof harness !== 'string' ||
      typeof gatewayModel !== 'string' ||
      typeof deadlineAt !== 'number'
    ) {
      continue;
    }
    if (row.hasOp) {
      // ONE liveness rule for every phase: the op's lease must be silent
      // past the staleness window — EXCEPT the ask-park: an awaiting_human
      // op is terminal with no result for up to 7 days by design, and
      // re-attaching it would settle a question mid-wait.
      if (
        row.opStatus !== 'running' &&
        row.agentResultStatus === 'awaiting_human'
      ) {
        continue;
      }
      const lastSignOfLife = sessionOpLastSignOfLifeMs({
        startedAt: row.opStartedAt ?? 0,
        ...(row.opHeartbeatAt !== null
          ? { heartbeatAt: row.opHeartbeatAt }
          : {}),
        ...(row.opFinalizedAt !== null
          ? { finalizedAt: row.opFinalizedAt }
          : {}),
        ...(row.opFinishedAt !== null ? { finishedAt: row.opFinishedAt } : {}),
      });
      if (lastSignOfLife >= staleBeforeMs) continue;
    }
    out.push({
      organizationId: row.organizationId,
      runId: row.runId,
      nodeId,
      execId,
      sessionId,
      harness,
      // The gateway ref is `<provider>/<model>`; the drive window only
      // carries the slug through to its own bookkeeping.
      providerSlug: gatewayModel.split('/')[0] ?? '',
      gatewayModel,
      deadlineAt,
    });
  }
  return out;
}

export async function recoverStalledWorkflowAgentTurns(
  sql: Sql,
  options: { staleMs?: number; probe?: typeof sessionExecStatus } = {},
): Promise<{ examined: number; resumed: number }> {
  const staleBeforeMs = Date.now() - (options.staleMs ?? RECOVERY_STALE_MS);
  const stalled = await listStalledWorkflowAgentTurns(sql, staleBeforeMs);
  const probe = options.probe ?? sessionExecStatus;
  let resumed = 0;
  for (const turn of stalled) {
    try {
      // Probe first — the drive window handles running, terminal and
      // vanished execs alike; this only proves the sandbox is reachable.
      await probe(turn.sessionId, turn.execId);
    } catch (error) {
      console.warn(
        `[automation-agent-watchdog] exec probe failed for ${turn.execId} (leaving for the next sweep):`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }
    const claimed = await claimRecoveryResume(sql, {
      sessionId: turn.sessionId,
      execId: turn.execId,
      staleBeforeMs,
      createMissing: {
        organizationId: turn.organizationId,
        kind: 'workflow-agent',
        deadlineMs: turn.deadlineAt,
      },
    });
    if (!claimed) {
      console.warn(
        `[automation-agent-watchdog] resume claim refused for ${turn.execId} of run ${turn.runId} — a live chain or a fresh settle owns it`,
      );
      continue;
    }
    await addJobInTx(sql, 'automation.agent_drive', {
      organizationId: turn.organizationId,
      runId: turn.runId,
      nodeId: turn.nodeId,
      execId: turn.execId,
      sessionId: turn.sessionId,
      harness: turn.harness,
      providerSlug: turn.providerSlug,
      gatewayModel: turn.gatewayModel,
      deadlineAt: turn.deadlineAt,
    });
    resumed += 1;
    console.warn(
      `[automation-agent-watchdog] re-attached abandoned turn ${turn.execId} of run ${turn.runId} (node ${turn.nodeId})`,
    );
  }
  return { examined: stalled.length, resumed };
}
