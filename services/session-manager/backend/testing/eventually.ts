// Waits for something that happens on its own schedule (a socket that closes,
// a server that gets the request): real timers, polled, so a test is as fast
// as the thing it waits for and a loaded machine has room. The budget is
// generous because a failure here means "never", not "slowly".

/** How often the condition is looked at. */
const POLL_MS = 10;
/** Longer than the slowest wait of a loaded CI runner, shorter than the test's own timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface EventuallyOptions {
  timeoutMs?: number;
  /** Names the wait in the failure. */
  what?: string;
}

/** Resolves once `condition` holds; rejects, saying what it waited for, when it does not in time. */
export async function eventually(
  condition: () => boolean,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    what = 'the condition',
  }: EventuallyOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
  }
}
