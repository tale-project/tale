/**
 * Wall-clock ceiling for one harness WORK turn — an automation `agent`
 * node or a project-agent task run. One harness turn is one product concept,
 * so the two lanes share this single source.
 *
 * This deadline is the only ABSOLUTE cap on a work turn, so it is sized for
 * the slowest legitimate work, not for hang detection: a document-heavy desk
 * run reading a whole quarter of scans through the vision hook worked
 * flat-out past the old 30-minute cap and was cut mid-read. Hangs are caught
 * elsewhere, and sooner — the sandbox exec's own `timeoutMs` is a SLIDING
 * orphan reaper (re-armed on every drain attach), and the abandoned-op sweep
 * is heartbeat-based — so a turn still making progress dies here and nowhere
 * else. Twelve hours reads as "a turn may work all day, never into tomorrow".
 *
 * V8-safe on purpose (no Node imports): the Node agent hosts and the V8
 * mutations that mint run rows both read it.
 */
const DEFAULT_AGENT_WORK_TURN_DEADLINE_MS = 12 * 3_600_000;

export function agentWorkTurnDeadlineMs(): number {
  const configured = Number(process.env.TALE_AUTOMATION_AGENT_DEADLINE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_AGENT_WORK_TURN_DEADLINE_MS;
}

/**
 * The moment a session op's chain last proved it was alive, across ALL turn
 * phases: the drain bumps `heartbeatAt` every attach window, the settle
 * holds the same lease (the finalize claim bumps it, the harvest bumps it
 * per file), and the terminal write stamps `finishedAt`. `finalizedAt` is
 * the settle election's claim stamp — a sign of life the instant it is
 * written. `startedAt` floors the result so a just-created row is never
 * younger than its own birth.
 *
 * This is the ONE liveness signal recovery judges — deliberately NOT an
 * execution-environment bound (an action time cap is deployment config and
 * an implementation accident of today's single-action settle, not a
 * contract). Every settle step is itself bounded (session-client and
 * gateway-admin calls carry 15–30s AbortSignal timeouts, mutations are
 * ms-scale), so a chain silent past the recovery staleness window is dead,
 * however slow or loaded the host. Read by the V8 recovery-claim mutation
 * and both lanes' stalled-turn queries.
 */
export function sessionOpLastSignOfLifeMs(op: {
  startedAt: number;
  heartbeatAt?: number;
  finalizedAt?: number;
  finishedAt?: number;
}): number {
  return Math.max(
    op.startedAt,
    op.heartbeatAt ?? 0,
    op.finalizedAt ?? 0,
    op.finishedAt ?? 0,
  );
}
