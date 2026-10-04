import type {
  AcceptanceObservation,
  AcceptancePlannedRow,
} from './acceptance-plan.ts';

/** Own one planned row. A checkpoint is written before tail/validity work;
 * failure never erases the action result or advances to a replacement sample. */
export async function recordAcceptanceAction<T extends object>(
  planned: AcceptancePlannedRow,
  io: {
    now: () => number;
    action: () => Promise<T & { durationMs: number }>;
    after: () => Promise<{ heapMiB: number } & Record<string, unknown>>;
    checkpoint: (
      row: AcceptanceObservation & Record<string, unknown>,
    ) => Promise<void>;
    append: (
      row: AcceptanceObservation & Record<string, unknown>,
    ) => Promise<void>;
  },
) {
  const row: AcceptanceObservation & Record<string, unknown> = {
    ...planned,
    startedAt: io.now(),
    complete: false,
    valid: false,
    error: 'Action has not completed',
  };
  let failure: unknown;
  try {
    await io.checkpoint(row);
    Object.assign(row, await io.action(), {
      actionObservedAt: io.now(),
      error: 'Post-action validity and tail pending',
    });
    await io.checkpoint(row);
    Object.assign(row, await io.after(), {
      finishedAt: io.now(),
      complete: true,
      valid: true,
    });
    delete row.error;
    await io.checkpoint(row);
  } catch (error) {
    failure = error;
    Object.assign(row, {
      complete: false,
      valid: false,
      error: String(error),
      failedAt: io.now(),
    });
    try {
      await io.checkpoint(row);
    } catch (writeError) {
      row.checkpointError = String(writeError);
    }
  }
  // Exactly one append attempt. A partial disk write must not be retried into
  // the same journal and produce duplicate or fabricated rows.
  await io.append(row);
  if (failure !== undefined) throw failure;
  return row;
}
