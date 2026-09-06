/**
 * Zero-dependency progress helpers for long-running CLI operations.
 *
 * Two needs, no external spinner/progress library:
 *
 *  1. `runStepsInParallel` — run independent async steps CONCURRENTLY while the
 *     terminal still reads like a sequential checklist: each step logs an
 *     `[N/total]` line as it settles. One failure never cancels in-flight work
 *     (Promise.allSettled semantics), and the caller gets every result back so
 *     it can decide how to handle partial failure. This is the "run things in
 *     parallel, but show step by step" behaviour for image pulls, health
 *     checks, etc.
 *
 *  2. `formatHeartbeat` — the heartbeat line `waitForHealthy` prints during
 *     long SILENT waits so a non-TTY/CI log (GitHub Actions, cron, systemd)
 *     never looks hung.
 *
 * The pure formatters are exported so they can be unit-tested without timers.
 */

import * as defaultLogger from './logger';

type StepLogger = Pick<
  typeof defaultLogger,
  'step' | 'success' | 'error' | 'info'
>;

interface ParallelStep<T> {
  /** Short label shown in the per-step `[N/total]` line. */
  label: string;
  /** The work. Resolving = success; throwing = failure (never cancels peers). */
  run: () => Promise<T>;
}

interface ParallelStepResult<T> {
  label: string;
  ok: boolean;
  value?: T;
  error?: unknown;
}

/** `[2/8] tale-platform:1.2.3` — the per-step checklist line. */
export function formatStepLine(
  done: number,
  total: number,
  label: string,
  ok: boolean,
): string {
  return `[${done}/${total}] ${label}${ok ? '' : ' — failed'}`;
}

/**
 * Run every step concurrently, logging `[N/total] <label>` as each settles.
 * Returns results in INPUT order (not completion order) so callers can map
 * back to their source list. Never rejects — failures surface as
 * `{ ok: false, error }` entries.
 */
export async function runStepsInParallel<T>(
  steps: ParallelStep<T>[],
  opts: { title?: string; log?: StepLogger } = {},
): Promise<ParallelStepResult<T>[]> {
  const log = opts.log ?? defaultLogger;
  const total = steps.length;
  if (opts.title) log.step(`${opts.title} (${total})`);

  let settled = 0;
  const settle = async (
    step: ParallelStep<T>,
  ): Promise<ParallelStepResult<T>> => {
    try {
      const value = await step.run();
      settled++;
      log.success(formatStepLine(settled, total, step.label, true));
      return { label: step.label, ok: true, value };
    } catch (error) {
      settled++;
      log.error(formatStepLine(settled, total, step.label, false));
      return { label: step.label, ok: false, error };
    }
  };

  return Promise.all(steps.map(settle));
}

/** `… still working: pulling images (no update for 30s)` */
export function formatHeartbeat(label: string, elapsedSeconds: number): string {
  return `… still working: ${label} (no update for ${elapsedSeconds}s)`;
}
