// What the server does when it is told to stop (Ctrl+C, `docker stop`, a
// closed terminal): stop gracefully, so that every browser closes and the tabs
// of each session are saved; but never hang. A stop that does not finish
// (Bun's `server.stop()` can wait for a socket for ever) is ended by a
// deadline, and a second signal from a person who is tired of waiting ends it
// at once. `server.ts` wires this to the process; the logic is here, where it
// can be tested.

/** The signals that stop the server. */
export const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
export type StopSignal = (typeof STOP_SIGNALS)[number];

/**
 * What a shell reports for a process killed by the signal (128 + its number):
 * the exit code of a second signal.
 */
const EXIT_CODES: Readonly<Record<StopSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

/**
 * How long after the time the browsers get to close (`SHUTDOWN_TIMEOUT_MS` of
 * the runtime) the server gives up on stopping.
 */
export const SHUTDOWN_MARGIN_MS = 10_000;

export interface ShutdownDeps {
  /** Closes the browsers and the database and stops listening. */
  stop: () => Promise<void>;
  exit: (code: number) => void;
  /** One line for the person at the terminal or the log (and the error that caused it, if any). */
  log: (line: string, cause?: unknown) => void;
  /** After this long the server exits 1 if it has not stopped. */
  deadlineMs: number;
}

/** The function to call on each signal. */
export function createShutdown(
  deps: ShutdownDeps,
): (signal: StopSignal) => void {
  let stopping = false;
  return (signal) => {
    if (stopping) {
      deps.log(
        `[session-manager] ${signal} again: not waiting for the browsers any longer`,
      );
      deps.exit(EXIT_CODES[signal]);
      return;
    }
    stopping = true;
    const watchdog = setTimeout(() => {
      deps.log(
        `[session-manager] the server did not stop within ${deps.deadlineMs / 1000} seconds: exiting`,
      );
      deps.exit(1);
    }, deps.deadlineMs);
    void (async () => {
      try {
        await deps.stop();
      } catch (error) {
        clearTimeout(watchdog);
        deps.log('[session-manager] stopping failed', error);
        deps.exit(1);
        return;
      }
      clearTimeout(watchdog);
      deps.exit(0);
    })();
  };
}
