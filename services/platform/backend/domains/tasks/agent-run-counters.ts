import type { Sql } from 'postgres';

import {
  AGENT_RUN_WAITING_REASONS,
  isAgentRunWaitingReason,
} from '../../../lib/shared/agent-run-waiting.ts';
import {
  isTaskRunFailureCode,
  TASK_RUN_FAILURE_CODES,
} from '../../../lib/shared/task-run-failure.ts';

/**
 * How often project agents' runs waited for room, were woken and failed:
 * the running totals the backend's metrics restate on every scrape
 * (`tale_backend_agent_run_*_total`, `backend/telemetry.ts`).
 *
 * The events happen in worker jobs (the turn host's park, a run's timed
 * wake, the watchdogs, every failure), and a worker serves no `/metrics`:
 * a counter kept in its memory would never reach a scrape. So each event
 * adds to a row of `app.agent_run_counters` (migration 0227), and the API
 * reads the rows back. Every API replica reports the same totals.
 *
 * An event counts once its own transaction has committed: the writers are
 * called after its `sql.begin` resolved, so a park that rolled back counts
 * nothing. The add is a statement of its own rather than part of that
 * transaction, so the row every organization's parks share is held for
 * that one statement, not until each park commits. It never throws: a total
 * that cannot be written is logged, and the park, wake or failure it counts
 * stands. A process that ends between the commit and the add loses that
 * one count.
 *
 * Every label comes from a closed set, with `unknown` for anything else, so
 * no organization, task or run id can become a series.
 */

/** What woke a parked run:
 * - `release` — a worker or slot was given back: a run ended, a workspace
 *   stopped, expired or was destroyed, a watchdog released a slot nothing
 *   held (`wakeParkedAgentRuns`, `wakeAgentParkedAgentRun`);
 * - `scheduled` — the run's own timed wake (`task.agent_park_wake`): its
 *   place in the sandbox host's line came up, its model's capacity probe,
 *   or a cleared capacity hold's wave;
 * - `watchdog` — the tasks watchdog's sweep of the parked runs
 *   (`wakeOrganizationParkedAgentRun`), which wakes a run no edge woke. */
export const AGENT_RUN_WAKE_SOURCES = [
  'release',
  'scheduled',
  'watchdog',
] as const;

export type AgentRunWakeSource = (typeof AGENT_RUN_WAKE_SOURCES)[number];

/** What a total counts: parks, woken runs, failed wakes or failed runs. */
export type AgentRunCounterEvent = 'park' | 'wake' | 'wake_failure' | 'failure';

/** What a park counts under: its waiting reason, or `unknown` for a park
 * whose cause has no reason of its own. */
export const AGENT_RUN_PARK_LABELS: readonly string[] = [
  ...AGENT_RUN_WAITING_REASONS,
  'unknown',
];

/** What a failure counts under: its failure code, or `unknown` for none
 * or one this build does not know. */
export const AGENT_RUN_FAILURE_LABELS: readonly string[] = [
  ...TASK_RUN_FAILURE_CODES,
  'unknown',
];

async function addToAgentRunCounter(
  sql: Sql,
  event: AgentRunCounterEvent,
  label: string,
  by: number,
): Promise<void> {
  try {
    await sql`
      INSERT INTO app.agent_run_counters AS c (event, label, total)
      VALUES (${event}, ${label}, ${by})
      ON CONFLICT (event, label) DO UPDATE SET total = c.total + EXCLUDED.total
    `;
  } catch (error) {
    console.warn(
      `[metrics] counting an agent run's ${event} (${label}) failed:`,
      error,
    );
  }
}

/** Count one run parked to wait for room, by why it waits. */
export async function countParkedAgentRun(
  sql: Sql,
  reason: string | null | undefined,
): Promise<void> {
  await addToAgentRunCounter(
    sql,
    'park',
    isAgentRunWaitingReason(reason) ? reason : 'unknown',
    1,
  );
}

/** Count the parked runs one wake woke; none counts nothing. */
async function countWokenAgentRuns(
  sql: Sql,
  source: AgentRunWakeSource,
  woken: number,
): Promise<void> {
  if (woken > 0) await addToAgentRunCounter(sql, 'wake', source, woken);
}

/** Count one wake that failed: the runs it would have woken stay parked
 * until the next wake. */
async function countFailedAgentRunWake(
  sql: Sql,
  source: AgentRunWakeSource,
): Promise<void> {
  await addToAgentRunCounter(sql, 'wake_failure', source, 1);
}

/** Count one run that failed, by its failure code. */
export async function countFailedAgentRun(
  sql: Sql,
  failureCode: string | null | undefined,
): Promise<void> {
  await addToAgentRunCounter(
    sql,
    'failure',
    isTaskRunFailureCode(failureCode) ? failureCode : 'unknown',
    1,
  );
}

/**
 * Run one wake and count what it did under `source`: the runs it woke, or
 * one failed wake when it threw. The wake's own answer and error pass
 * through unchanged.
 */
export async function countedAgentRunWake(
  sql: Sql,
  source: AgentRunWakeSource,
  wake: () => Promise<number>,
): Promise<number> {
  let woken: number;
  try {
    woken = await wake();
  } catch (error) {
    await countFailedAgentRunWake(sql, source);
    throw error;
  }
  await countWokenAgentRuns(sql, source, woken);
  return woken;
}

/** The totals of one event, by label, as the counters hold them. */
export async function readAgentRunCounters(
  sql: Sql,
  event: AgentRunCounterEvent,
): Promise<Map<string, number>> {
  const rows = await sql<{ label: string; total: string }[]>`
    SELECT label, total::text AS total FROM app.agent_run_counters
    WHERE event = ${event}
  `;
  return new Map(rows.map((row) => [row.label, Number(row.total)]));
}
