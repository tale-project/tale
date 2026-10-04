// How runnerd ends itself. `process.exit` first waits for every thread of
// libuv's pool, and a read of another process's /proc files can hold one for
// as long as that process is stuck (its memory lock taken under memory
// pressure; process-reaper.ts). An exit then hangs until the orchestrator
// kills the container, and no timer can step in: the wait blocks the event
// loop itself. With such a read still out, runnerd ends itself by SIGKILL,
// which waits for nothing.

import { pendingProcReads } from './process-reaper.ts';

export interface ExitDeps {
  /** How many reads of the process table have not come back. */
  pendingReads?: () => number;
  exit?: (code: number) => void;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  pid?: number;
}

/** End the daemon with `code`, or by SIGKILL when an exit would wait on a
 * read that may never come back. */
export function exitDaemon(code: number, deps: ExitDeps = {}): void {
  const pending = (deps.pendingReads ?? pendingProcReads)();
  if (pending > 0) {
    console.warn(
      `[runnerd] ${pending} process read(s) have not come back; ending by SIGKILL`,
    );
    const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
    kill(deps.pid ?? process.pid, 'SIGKILL');
    return;
  }
  const exit = deps.exit ?? ((status: number) => process.exit(status));
  exit(code);
}
