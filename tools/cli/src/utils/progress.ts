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
 *  2. `startActivityWatchdog` — emit a heartbeat line during long SILENT waits
 *     so a non-TTY/CI log (GitHub Actions, cron, systemd) never looks hung.
 *     A no-op under a real TTY, where the live status header already shows
 *     liveness.
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

interface ActivityWatchdog {
  /** Reset the silence timer; call when meaningful progress happens. */
  beat: () => void;
  /** Stop the watchdog. Always call in a `finally`. */
  stop: () => void;
}

/** `… still working: pulling images (no update for 30s)` */
export function formatHeartbeat(label: string, elapsedSeconds: number): string {
  return `… still working: ${label} (no update for ${elapsedSeconds}s)`;
}

/**
 * Print a heartbeat every `intervalMs` of SILENCE so a long wait in a non-TTY
 * log isn't mistaken for a hang. No-op under a TTY (unless `force`), because
 * the live status header already conveys liveness there. The timer is
 * `unref`'d so it never keeps the process alive on its own.
 */
export function startActivityWatchdog(
  label: string,
  opts: {
    intervalMs?: number;
    isTTY?: boolean;
    log?: Pick<typeof defaultLogger, 'info'>;
    now?: () => number;
    force?: boolean;
  } = {},
): ActivityWatchdog {
  const intervalMs = opts.intervalMs ?? 15_000;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const log = opts.log ?? defaultLogger;
  const now = opts.now ?? (() => Date.now());

  // Under a TTY the status header shows liveness — don't double up.
  if (isTTY && !opts.force) {
    return { beat: () => {}, stop: () => {} };
  }

  let last = now();
  const timer = setInterval(() => {
    const elapsed = now() - last;
    if (elapsed >= intervalMs) {
      log.info(formatHeartbeat(label, Math.round(elapsed / 1000)));
    }
  }, intervalMs);
  // Don't let the heartbeat alone keep the event loop alive.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    beat: () => {
      last = now();
    },
    stop: () => clearInterval(timer),
  };
}
