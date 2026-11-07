/**
 * The longest a route waits for a read its first frame depends on: the wait
 * after which TanStack Router would show a page as pending (its default
 * `pendingMs`). A local server answers in milliseconds, so the page comes with
 * its data; a read that takes longer goes on, and the page shows that part
 * masked until it comes, as it did before routes waited at all.
 */
export const ROUTE_READ_WAIT_MS = 1_000;

/**
 * Waits for a read a route's loader started (`ensureQueryData`), at most
 * `ROUTE_READ_WAIT_MS`. It never fails: a read that fails is the page's to
 * show, in its own words, and `onFailure` decides whether it is worth a line
 * in the console.
 */
export async function waitForRead(
  read: Promise<unknown>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ROUTE_READ_WAIT_MS);
  });
  try {
    await Promise.race([read.then(() => undefined, onFailure), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** What `readsSettled` needs of the query client: how many reads are in flight, and word of a change. */
export interface ReadsInFlight {
  isFetching(): number;
  getQueryCache(): { subscribe(listener: () => void): () => void };
}

/**
 * Waits until no read is in flight, at most `ms`. Before the first frame
 * (`app/main.tsx`): the lists a route asks for with its page and does not
 * wait for (a navigation is never held back by a list) are there by the first
 * frame too, so the page opens with its rows instead of masked ones that an
 * answer replaces a moment later. It never fails.
 */
export function readsSettled(
  client: ReadsInFlight,
  ms: number = ROUTE_READ_WAIT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    if (client.isFetching() === 0) {
      resolve();
      return;
    }
    let unsubscribe = (): void => {};
    const done = (): void => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, ms);
    unsubscribe = client.getQueryCache().subscribe(() => {
      if (client.isFetching() === 0) done();
    });
  });
}
