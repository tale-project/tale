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
