/**
 * Hard loop caps for the migration runner — stops so a logic bug (a cursor
 * that never advances, a batch that never drains) can never spin an action
 * forever. Production always runs the defaults; tests inject tiny values via
 * `setLimitsForTest` to exercise the cap paths without 100k iterations.
 */

export interface RunnerLimits {
  /** Max batch mutations per db/component migration run. */
  readonly maxBatches: number;
  /** Max Better Auth organization pages per node migration run. */
  readonly maxOrgPages: number;
}

export const DEFAULT_LIMITS: RunnerLimits = {
  maxBatches: 100_000,
  maxOrgPages: 10_000,
};

let current: RunnerLimits = DEFAULT_LIMITS;

export function getLimits(): RunnerLimits {
  return current;
}

/** Test-only override; call `resetLimits` in afterEach. */
export function setLimitsForTest(overrides: Partial<RunnerLimits>): void {
  current = { ...DEFAULT_LIMITS, ...overrides };
}

export function resetLimits(): void {
  current = DEFAULT_LIMITS;
}
