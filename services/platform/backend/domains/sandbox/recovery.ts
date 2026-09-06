import type { Sql } from 'postgres';

import { sessionOpLastSignOfLifeMs } from '../../core/sandbox/agent_deadline.ts';
import type { SandboxAgentOpKind } from '../../core/sandbox/session_constants.ts';

/**
 * The agent-turn recovery primitives shared by the task and automation
 * re-attach sweeps — the 0.5 twin of 0.4's
 * `sandbox/session_mutations.claimRecoveryResume`. The op row is the one
 * liveness record every drive chain bumps, so the claim that fences a
 * re-attach lives with the sandbox domain that owns it, not with either
 * lane's sweep.
 */

/** A live drainer bumps the op heartbeat once per window (~90s); silence
 * past this means the chain is gone. Same knob as 0.4. */
export const RECOVERY_STALE_MS = (() => {
  const configured = Number(process.env.TALE_AGENT_TURN_RECOVERY_STALE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 4 * 60 * 1000;
})();

/**
 * Claim the resume for one turn. Returns false when something signed the
 * op's lease after the listing read it — a live chain's bump, a concurrent
 * sweep, or a settle still proving life.
 *
 * The three phase shapes 0.4 documented all heal here: a MISSING op row is
 * created (the insert IS the claim), a TERMINAL op row is latched (the op
 * finished; only the run-side settle died), and a RUNNING one has its lease
 * bumped with a dead finalize winner's election RE-OPENED.
 */
export async function claimRecoveryResume(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    staleBeforeMs: number;
    createMissing: {
      organizationId: string;
      /** The lane's own op kind — the run-card and metric reads are keyed
       * on it, so a row created under any other kind stays invisible. */
      kind: SandboxAgentOpKind;
      deadlineMs: number;
    };
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        status: string;
        startedAt: number;
        heartbeatAt: number | null;
        finalizedAt: number | null;
        finishedAt: number | null;
      }[]
    >`
      SELECT id, status, started_at_ms::float8 AS "startedAt",
             heartbeat_at_ms::float8 AS "heartbeatAt",
             finalized_at_ms::float8 AS "finalizedAt",
             finished_at_ms::float8 AS "finishedAt"
      FROM app.sandbox_session_ops
      WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
      FOR UPDATE
    `;
    const row = rows[0];
    const now = Date.now();
    if (row === undefined) {
      await tx`
        INSERT INTO app.sandbox_session_ops (
          org_id, session_id, exec_id, kind, status, deadline_ms,
          started_at_ms, heartbeat_at_ms, resumed_by
        ) VALUES (
          ${args.createMissing.organizationId}, ${args.sessionId},
          ${args.execId}, ${args.createMissing.kind}, 'running',
          ${args.createMissing.deadlineMs}, ${now}, ${now}, 'watchdog'
        )
        ON CONFLICT (session_id, exec_id) DO NOTHING
      `;
      return true;
    }
    const lastSignOfLife = sessionOpLastSignOfLifeMs({
      startedAt: row.startedAt,
      ...(row.heartbeatAt !== null ? { heartbeatAt: row.heartbeatAt } : {}),
      ...(row.finalizedAt !== null ? { finalizedAt: row.finalizedAt } : {}),
      ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
    });
    // A live chain signed the lease after the listing → NOT abandoned.
    if (lastSignOfLife >= args.staleBeforeMs) return false;
    if (row.status !== 'running') {
      // Terminal op, dead run-side settle: latch only — the op is done.
      await tx`
        UPDATE app.sandbox_session_ops
        SET heartbeat_at_ms = ${now}, resumed_by = 'watchdog'
        WHERE id = ${row.id}
      `;
      return true;
    }
    await tx`
      UPDATE app.sandbox_session_ops SET
        heartbeat_at_ms = ${now}, resumed_by = 'watchdog',
        -- Dead finalize winner: re-open the election it claimed but never won.
        finalized_at_ms = NULL
      WHERE id = ${row.id}
    `;
    return true;
  });
}
