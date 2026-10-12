import type { Sql } from 'postgres';

import {
  STEP_FAILURE_REASONS,
  type StepFailureReason,
} from '../../../lib/engine/core/record/failure.ts';
import {
  isRunFailureCode,
  type RunFailureCode,
} from '../../core/automations/failure.ts';

interface WakeAdmissionFailure {
  failureCode: RunFailureCode | null;
  stepRecorded: boolean;
  stepFailed: boolean;
  stepFailureCode: RunFailureCode | null;
  stepFailureReason: StepFailureReason | null;
}

/** Only finite stored codes leave the fixture. No detail, params, trace or
 * values are read: even a saved engine failure can contain service text. */
export async function readWakeAdmissionFailure(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<WakeAdmissionFailure | null> {
  const rows = await sql<
    {
      failureCode: unknown;
      stepStatus: unknown;
      stepFailureCode: unknown;
      stepFailureReason: unknown;
    }[]
  >`
    SELECT r.failure_code AS "failureCode", n.status AS "stepStatus",
           n.failure_code AS "stepFailureCode",
           n.record #>> '{failure,reason}' AS "stepFailureReason"
    FROM app.automation_runs r
    LEFT JOIN app.automation_node_runs n
      ON n.org_id = r.org_id AND n.run_id = r.id
      AND n.node_id = 'start' AND n.node_type = 'task.start_agent'
      AND n.path = 'start' AND n.item_index = -1 AND n.pass = -1
    WHERE r.org_id = ${organizationId} AND r.id = ${runId}
      AND r.status = 'failed'
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    failureCode: isRunFailureCode(row.failureCode) ? row.failureCode : null,
    stepRecorded:
      row.stepStatus === 'running' ||
      row.stepStatus === 'waiting' ||
      row.stepStatus === 'ok' ||
      row.stepStatus === 'skipped' ||
      row.stepStatus === 'failed',
    stepFailed: row.stepStatus === 'failed',
    stepFailureCode: isRunFailureCode(row.stepFailureCode)
      ? row.stepFailureCode
      : null,
    stepFailureReason:
      STEP_FAILURE_REASONS.find((reason) => reason === row.stepFailureReason) ??
      null,
  };
}

/** W18's fixture observation only; it does not admit, retry or cancel a run. */
export async function observeWakeManagerAdmission<
  Run extends { id: string },
  State extends { firedRunId: string | null },
  Scan,
>(args: {
  expectedCount: number;
  timeoutMs: number;
  backdate: () => Promise<unknown>;
  managerRuns: () => Promise<Run[]>;
  scan: () => Promise<Scan>;
  wake: () => Promise<State | null>;
  occurrence: (runId: string | null) => Promise<{
    status: string;
    output: unknown;
  } | null>;
  readFailure: (runId: string) => Promise<WakeAdmissionFailure | null>;
  trace?: { first: unknown[]; last: unknown[] };
  waitFor: (
    ready: () => Promise<boolean>,
    timeoutMs: number,
  ) => Promise<boolean>;
}): Promise<Run> {
  const before = new Set((await args.managerRuns()).map((run) => run.id));
  const { first, last } = args.trace ?? { first: [], last: [] };
  const observed: {
    firstFailedOccurrence: { runId: string; sample: unknown } | null;
  } = { firstFailedOccurrence: null };
  let manager: Run | undefined;
  await args.backdate();
  const admitted = await args.waitFor(async () => {
    const result = await args.scan();
    const state = await args.wake();
    const runs = await args.managerRuns();
    manager = runs.find((run) => !before.has(run.id));
    const ended = await args.occurrence(state?.firedRunId ?? null);
    const sample = {
      expectedCount: args.expectedCount,
      result,
      state,
      runs: runs.length,
      occurrence: ended?.status,
    };
    if (first.length < 8) first.push(sample);
    last.push(sample);
    if (last.length > 8) last.shift();
    if (
      observed.firstFailedOccurrence === null &&
      ended?.status === 'failed' &&
      state?.firedRunId !== null &&
      state?.firedRunId !== undefined
    )
      observed.firstFailedOccurrence = { runId: state.firedRunId, sample };
    const output = ended?.output;
    return (
      runs.length === args.expectedCount &&
      manager !== undefined &&
      ended?.status === 'success' &&
      typeof output === 'object' &&
      output !== null &&
      'runId' in output &&
      output.runId === manager.id
    );
  }, args.timeoutMs);
  if (!admitted || manager === undefined) {
    const failure =
      observed.firstFailedOccurrence === null
        ? null
        : {
            ...observed.firstFailedOccurrence,
            expectedCount: args.expectedCount,
            failure: await args.readFailure(
              observed.firstFailedOccurrence.runId,
            ),
          };
    throw new Error(
      `itest: W18 manager admission not observed: ${JSON.stringify({ first, last, firstFailedOccurrence: failure })}`,
    );
  }
  return manager;
}
