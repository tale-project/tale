// Helpers for tests of code that is promises all the way down.

/**
 * Lets everything that can run without a timer run (the loops of the code
 * under test are promise chains): `rounds` turns of the event loop.
 */
export async function settle(rounds = 1): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Watches a promise: `settled` turns true once it resolved or rejected. */
export function track(promise: Promise<unknown>): {
  readonly settled: boolean;
} {
  const state = { settled: false };
  const markSettled = (): void => {
    state.settled = true;
  };
  promise.then(markSettled, markSettled);
  return state;
}
