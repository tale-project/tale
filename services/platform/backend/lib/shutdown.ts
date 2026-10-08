/**
 * The process's shutdown state, as the work it runs sees it.
 *
 * A stopping backend used to give its jobs nothing but pg-boss's graceful
 * stop: a walker in the middle of an automation step kept going until the
 * container's kill grace ran out and was cut mid-call, and its run sat with
 * a dead lease until another worker took it over. Two signals let the work
 * stop on purpose instead:
 *
 * - `signal` aborts the moment shutdown begins. A walker hands its run on
 *   at its next step boundary, and an agent turn's drive window ends at
 *   once and leaves its next window to another process.
 * - `interrupt` aborts a grace period later. A step body still running then
 *   is cut: the walker hands its run on without recording the step, and the
 *   next process runs it again (a write that may already have reached its
 *   service waits for a person instead — the effect ledger decides).
 *
 * `main.ts` drives the one {@link processShutdown}; a test builds its own
 * with {@link createShutdownState}.
 */

/** How long a step body may keep running once shutdown has begun before it
 * is cut. The stop budget around it (`SHUTDOWN_DRAIN_MS`) may shorten it. */
export const NODE_SHUTDOWN_GRACE_MS = 20_000;

/** The reason both shutdown signals abort with: work that stopped on one
 * was interrupted, it did not fail. */
export class ShutdownInterruption extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShutdownInterruption';
  }
}

export interface ShutdownState {
  /** Aborted the moment shutdown begins. */
  readonly signal: AbortSignal;
  /** Aborted `graceMs` after shutdown begins: step bodies still running are
   * cut. */
  readonly interrupt: AbortSignal;
  /** Whether shutdown has begun. */
  readonly shuttingDown: boolean;
  /** Begin shutting down. Only the first call counts; the grace timer never
   * keeps the process alive on its own. */
  begin(reason: string, graceMs: number): void;
}

export function createShutdownState(): ShutdownState {
  const begun = new AbortController();
  const interrupted = new AbortController();
  return {
    signal: begun.signal,
    interrupt: interrupted.signal,
    get shuttingDown() {
      return begun.signal.aborted;
    },
    begin(reason, graceMs) {
      if (begun.signal.aborted) return;
      begun.abort(
        new ShutdownInterruption(`the server is shutting down (${reason})`),
      );
      const cut = () =>
        interrupted.abort(
          new ShutdownInterruption(
            `the step was interrupted because its server is shutting down (${reason})`,
          ),
        );
      if (graceMs <= 0) {
        cut();
        return;
      }
      setTimeout(cut, graceMs).unref();
    },
  };
}

/** The shutdown state of this process. */
export const processShutdown: ShutdownState = createShutdownState();
