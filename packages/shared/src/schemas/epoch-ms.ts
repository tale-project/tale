import { z } from 'zod';

/**
 * The latest instant a JavaScript `Date` can hold, in epoch milliseconds —
 * ECMA-262's time values run ±8.64e15 ms, to 275760-09-13. The safe-integer
 * range `.int()` enforces is wider: `9e15` passes it, and
 * `new Date(9e15).toISOString()` throws, so one such stored stamp fails every
 * read that renders its row.
 */
export const EPOCH_MS_MAX = 8_640_000_000_000_000;

/**
 * A timestamp as every door takes it: whole epoch milliseconds from 0 to
 * {@link EPOCH_MS_MAX}. `.int()` runs first and stops the checks when it
 * fails: past the safe-integer range it and `.max()` would report one
 * problem twice, and an `.int()` after `.max()` would widen the published
 * JSON Schema back to the safe-integer bounds.
 */
export const epochMsSchema = z
  .number()
  .int({ abort: true })
  .min(0)
  .max(EPOCH_MS_MAX);

/**
 * Whether `value` is a timestamp {@link epochMsSchema} takes. For readers of
 * stored rows, which must not throw on a stamp written before its door held
 * it to the bound.
 */
export function isEpochMs(value: unknown): value is number {
  return epochMsSchema.safeParse(value).success;
}
