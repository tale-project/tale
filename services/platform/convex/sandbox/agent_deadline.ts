/**
 * Wall-clock ceiling for one harness WORK turn — an automation `agent`
 * node or a project-agent task run. One harness turn is one product concept, so the
 * two lanes share this single source; interactive chat keeps its own, much
 * shorter ceiling (`EXTERNAL_TURN_DEADLINE_MS`).
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
