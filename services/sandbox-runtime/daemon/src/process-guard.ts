// What runnerd does with an error nothing handled. runnerd is the only child
// of the session container's init, so the daemon ending ends the container
// and every exec running in it. Node ends a process on an unhandled promise
// rejection by default: one stray rejection in a request path would take the
// whole session with it. A rejection is logged and the daemon carries on, as
// the spawner does. An uncaught exception leaves the daemon in an unknown
// state, so it stops the way a SIGTERM stops it (live execs are told to end,
// bounded by the forced deadline) and exits with a code of its own.

/** The exit code after an uncaught exception: EX_SOFTWARE from
 * sysexits(3), apart from a graceful stop's 0, Node's own 1 and 7, and the
 * 128 + N of a signal. */
export const UNCAUGHT_EXCEPTION_EXIT_CODE = 70;

/** The two process events the guards listen to. */
interface ProcessEvents {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  on(
    event: 'uncaughtException',
    listener: (error: Error, origin: string) => void,
  ): unknown;
}

export interface ProcessGuardDeps {
  /** Stop the daemon: pass the stop on to the live execs, close the
   * server and exit with `code`, bounded by the forced deadline. */
  shutdown: (code: number) => void;
  /** Where the handlers go — the process itself unless a test hands in
   * another emitter. */
  events?: ProcessEvents;
}

/** Install runnerd's handlers for errors nothing else handled. */
export function installProcessGuards(deps: ProcessGuardDeps): void {
  const events = deps.events ?? process;
  events.on('unhandledRejection', (reason) => {
    console.error('[runnerd] unhandled rejection (surviving):', reason);
  });
  let stopping = false;
  events.on('uncaughtException', (error, origin) => {
    console.error(
      `[runnerd] uncaught exception (${origin}); stopping live execs and exiting ${UNCAUGHT_EXCEPTION_EXIT_CODE}:`,
      error,
    );
    // A second one while the stop runs changes nothing: the stop already
    // under way exits, and its forced deadline still holds.
    if (stopping) return;
    stopping = true;
    deps.shutdown(UNCAUGHT_EXCEPTION_EXIT_CODE);
  });
}
