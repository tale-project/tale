import assert from 'node:assert/strict';

export const dialogPlan = Object.freeze(
  (['baseline', 'candidate', 'candidate', 'baseline'] as const).map(
    (arm, index) => Object.freeze({ index, arm, targetIndex: index }),
  ),
);
export type DialogAttempt = (typeof dialogPlan)[number];

/** One serial plan: a failed attempt remains retained and stops later attempts.
 * Neither partial evidence nor a slow action admits a replacement collection. */
export async function runDialogPlan(io: {
  before: (attempt: DialogAttempt) => Promise<void>;
  run: (attempt: DialogAttempt) => Promise<void>;
  failure: (attempt: DialogAttempt, error: unknown) => Promise<void>;
}) {
  for (const attempt of dialogPlan) {
    try {
      await io.before(attempt);
      await io.run(attempt);
    } catch (error) {
      try {
        await io.failure(attempt, error);
      } catch (writeError) {
        throw new AggregateError(
          [error, writeError],
          `Dialog attempt and evidence failed: ${String(error)}`,
          { cause: writeError },
        );
      }
      throw error;
    }
  }
}

/** Enforce the causal collection boundary without exposing trace control to
 * board setup or attribute inspection. Every entrypoint follows this order. */
export async function collectDialogAttempt<T, P>(io: {
  load: () => Promise<{ boardReady: true; taskDetailReads: number }>;
  prepare: () => Promise<void>;
  collect: () => Promise<T>;
  checkpoint: (primary: T) => Promise<void>;
  inspect: (state: 'open' | 'closed') => Promise<P>;
  close: () => Promise<void>;
}) {
  const loaded = await io.load();
  assert.equal(loaded.boardReady, true, 'Board must be ready before tracing');
  assert.equal(loaded.taskDetailReads, 0, 'Task detail must not be prewarmed');
  await io.prepare();
  const primary = await io.collect();
  await io.checkpoint(primary);
  const open = await io.inspect('open');
  await io.close();
  const closed = await io.inspect('closed');
  return { primary, postCollection: { open, closed } };
}
