/**
 * Whether this replica is being drained, as a question a walker can ask at
 * every step boundary without a database read each time.
 *
 * The probe answers what it last read and refreshes in the background at
 * most once per `refreshMs`, so a walker on a colour that a deploy began to
 * drain hands its run on within a step or two of the drain, and a run of a
 * hundred quick steps costs a read every few seconds, not a hundred. Until
 * its first read lands it answers "not draining": a step job claimed on a
 * draining replica is handed over by the worker before it reaches a walker
 * (`jobs/runner.ts`), so the probe only has to catch walkers already under
 * way.
 */

const DRAIN_PROBE_REFRESH_MS = 5_000;

export function createDrainProbe(
  read: () => Promise<boolean>,
  options: { refreshMs?: number; now?: () => number } = {},
): () => boolean {
  const refreshMs = options.refreshMs ?? DRAIN_PROBE_REFRESH_MS;
  const now = options.now ?? Date.now;
  let draining = false;
  let readAt = Number.NEGATIVE_INFINITY;
  let reading = false;
  return () => {
    if (!reading && now() - readAt >= refreshMs) {
      reading = true;
      readAt = now();
      void read()
        .then((answer) => {
          draining = answer;
        })
        .catch((error: unknown) => {
          // The last answer stands: a drain read that failed is no reason to
          // hand every run on, nor to stop handing them on.
          console.warn('[backend] drain probe read failed:', error);
        })
        .finally(() => {
          reading = false;
        });
    }
    return draining;
  };
}
