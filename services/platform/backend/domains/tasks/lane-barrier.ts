/**
 * A barrier for real-database lanes whose bodies must all reach one point
 * before any goes on — two transactions held after their first writes, so
 * that their next writes overlap (#4540 W25).
 *
 * The barrier is strict. The bodies are released together, and only once
 * every one of them has arrived. If they have not all arrived within
 * `timeoutMs`, the barrier breaks for good: every waiting arrival and every
 * later one rejects, so a held body aborts (its transaction rolls back)
 * instead of going on alone, and `met()` stays false. A lane built on it can
 * therefore never report an interleaving it did not force.
 */
export function laneBarrier(
  count: number,
  timeoutMs: number,
  onRelease?: () => void,
) {
  const waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
  let state: 'open' | 'met' | 'broken' = 'open';
  const breakWith = (reason: string) => {
    if (state !== 'open') return;
    state = 'broken';
    const error = new Error(
      `lane barrier broken: ${reason} (${waiting.length}/${count} arrived)`,
    );
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  };
  const timer = setTimeout(
    () => breakWith(`not every body arrived within ${timeoutMs} ms`),
    timeoutMs,
  );
  return {
    /** Wait until every body has arrived; rejects once the barrier broke. */
    arrive: () =>
      new Promise<void>((resolve, reject) => {
        if (state !== 'open') {
          reject(new Error(`lane barrier ${state}: arrival refused`));
          return;
        }
        waiting.push({ resolve, reject });
        if (waiting.length < count) return;
        state = 'met';
        clearTimeout(timer);
        onRelease?.();
        for (const waiter of waiting.splice(0)) waiter.resolve();
      }),
    /** Whether every body arrived before any was released. */
    met: () => state === 'met',
    /** Bounded cleanup: stop the timer; a barrier still open breaks. */
    dispose: () => {
      clearTimeout(timer);
      breakWith('disposed');
    },
  };
}
