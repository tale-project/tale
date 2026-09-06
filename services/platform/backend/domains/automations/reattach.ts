import type { Sql } from 'postgres';

import { sessionExecStatus } from '../../core/node_only/sandbox/helpers/session_client.ts';
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
 *
 * Every predicate lives in SQL and the walk is OLDEST first, like the task
 * lane's twin: `waiting` is not "one agent turn in flight" — it also holds
 * every approval park (indefinite), every ask park (up to 7 days) and every
 * healthy in-flight turn, deployment-wide. A newest-first page of the whole
 * waiting fleet filtered afterwards in JS re-selected the same newest rows
 * on every sweep, so a stalled turn behind enough newer parks was never
 * re-attached and failed at its deadline with the misleading "ran past its
 * time limit" — the very outcome this module exists to prevent. Liveness is
 * the same rule `sessionOpLastSignOfLifeMs` states — the greatest of the
 * op's start/heartbeat/finalized/finished stamps — spelled in SQL so the
 * bound applies to the CANDIDATES, not to a page of unrelated rows.
 */
async function listStalledWorkflowAgentTurns(
  sql: Sql,
  staleBeforeMs: number,
): Promise<StalledWorkflowTurn[]> {
  const rows = await sql<
    { runId: string; organizationId: string; cursor: unknown }[]
  >`
    SELECT r.id AS "runId", r.org_id AS "organizationId",
           r.checkpoints -> 'cursor' AS cursor
    FROM app.automation_runs r
    LEFT JOIN app.sandbox_session_ops op
      ON op.session_id = r.checkpoints -> 'cursor' -> 'agent' ->> 'sessionId'
     AND op.exec_id = r.checkpoints -> 'cursor' -> 'agent' ->> 'execId'
    WHERE r.status = 'waiting'
      -- An unsettled agent turn: a settled one is the stepper's to consume.
      AND r.checkpoints -> 'cursor' -> 'agent' IS NOT NULL
      AND r.checkpoints -> 'cursor' -> 'agent' -> 'result' IS NULL
      -- The ask-park exemption: an awaiting_human op is terminal with no
      -- result for up to 7 days by design; re-attaching it would settle a
      -- question mid-wait.
      AND (
        op.id IS NULL
        OR op.status = 'running'
        OR op.agent_result_status IS DISTINCT FROM 'awaiting_human'
      )
      -- ONE liveness rule for every phase: no op row at all, or a lease
      -- silent past the staleness window.
      AND (
        op.id IS NULL
        OR greatest(
             coalesce(op.started_at_ms, 0),
             coalesce(op.heartbeat_at_ms, 0),
             coalesce(op.finalized_at_ms, 0),
             coalesce(op.finished_at_ms, 0)
           ) < ${staleBeforeMs}
      )
    ORDER BY r.started_at_ms ASC
    LIMIT ${SWEEP_LIMIT}
  `;
  const out: StalledWorkflowTurn[] = [];
  for (const row of rows) {
    // The shape guards stay: a cursor the SQL matched but the drive window
    // could not consume is left alone, not re-attached blind.
    const cursor = row.cursor;
    if (!isRecord(cursor)) continue;
    const nodeId = cursor.node;
    const agent = cursor.agent;
    if (!isRecord(agent) || typeof nodeId !== 'string') continue;
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

/**
 * Recover answered asks whose resume was lost — the counterpart to the
 * awaiting_human exemption above.
 *
 * Answering an ask enqueues one `automation.ask_resume` job. If the worker
 * dies between the answer and the cursor retarget (a deploy/restart), nothing
 * re-drives it: the re-attach sweep SKIPS any ask-parked turn (op terminal,
 * `awaiting_human`) unconditionally — right while the ask is pending, but it
 * cannot tell answered from unanswered — so the run parks on the dead asking
 * exec until the ask's 7-day deadline, then fails with a misleading reason.
 *
 * A run still parked on the ASKING exec (cursor.agent.execId == ask.execId,
 * no result) whose ask is already `answered` is exactly that lost resume.
 * Re-enqueue it. The resume is idempotent: `retargetAgentCursor` is a
 * FOR-UPDATE CAS on the asking exec, and any throw self-settles the run — so a
 * resume that already retargeted (cursor moved off the asking exec) no-ops
 * here, and a racing pair yields a single winner. The `answered_at_ms` gate
 * spares a resume that is merely in flight (a healthy one retargets in
 * seconds, well inside the staleness window).
 */
export async function recoverAnsweredAskResumes(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ examined: number; requeued: number }> {
  const staleBefore = Date.now() - (options.staleMs ?? RECOVERY_STALE_MS);
  const rows = await sql<{ organizationId: string; askId: string }[]>`
    SELECT r.org_id AS "organizationId", a.id AS "askId"
    FROM app.automation_runs r
    JOIN app.automation_human_asks a
      ON a.run_id = r.id AND a.org_id = r.org_id
    WHERE r.status = 'waiting'
      AND a.status = 'answered'
      AND a.answered_at_ms < ${staleBefore}
      AND r.checkpoints -> 'cursor' ->> 'node' = a.node_id
      AND r.checkpoints -> 'cursor' -> 'agent' ->> 'execId' = a.exec_id
      AND r.checkpoints -> 'cursor' -> 'agent' -> 'result' IS NULL
    ORDER BY a.answered_at_ms
    LIMIT ${SWEEP_LIMIT}
  `;
  let requeued = 0;
  for (const row of rows) {
    await addJobInTx(sql, 'automation.ask_resume', {
      organizationId: row.organizationId,
      askId: row.askId,
    });
    requeued += 1;
    console.warn(
      `[automation-agent-watchdog] re-enqueued lost ask_resume for ask ${row.askId} — its run still parks on the asking exec`,
    );
  }
  return { examined: rows.length, requeued };
}
