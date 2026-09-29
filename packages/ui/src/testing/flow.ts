/**
 * Waits for a React Flow view to come to rest, for browser tests
 * (`*.browser.test.{ts,tsx}`) that measure a canvas after it pans or zooms.
 *
 * React Flow eases the view with d3 on `requestAnimationFrame`, outside the
 * Web Animations API: `element.getAnimations()` has nothing to await, and a
 * fixed pause only guesses how fast a loaded runner draws its frames. While
 * an ease runs, every frame writes a new transform onto the viewport, so the
 * view is at rest once a frame goes by without one. `FlowCanvas`'s own tests
 * and every editor built on it share this rather than re-typing it per test.
 *
 * Call it once the move has begun — the frames before an ease's first step
 * hold still too. Resolves with the transform the view came to rest at.
 *
 * A view that never settles — an ease that does not end, a refit loop —
 * would otherwise keep this waiting until the test's own timeout, whose
 * message names neither the viewport nor where it was. So once `timeout`
 * milliseconds (5 s by default) pass without two frames going by that leave
 * the view where it was, it rejects, naming the last transform it read.
 * Frames that stop coming end the wait the same way — a hidden or throttled
 * page draws none, and no read can then tell whether the view still moves —
 * and a wait in which not one frame came says so.
 */
export async function viewportAtRest(
  within: ParentNode = document,
  { timeout = 5_000 }: { timeout?: number } = {},
): Promise<string> {
  const read = () => {
    const viewport = within.querySelector<HTMLElement>('.react-flow__viewport');
    if (viewport === null) throw new Error('no React Flow viewport');
    return viewport.style.transform;
  };
  const deadline = performance.now() + timeout;
  let seen = read();
  // Whether any frame came at all: without one, the failure is the page's
  // (hidden, throttled), not a view that kept moving.
  let framed = false;
  const unsettled = () =>
    new Error(
      `React Flow viewport never came to rest within ${timeout} ms (last transform: ${seen}${framed ? '' : '; no animation frame ran'})`,
    );
  for (;;) {
    // Two frames, so the ease has stepped at least once between the reads
    // whichever order a frame runs its callbacks in — raced against the time
    // left, since frames that stop coming would otherwise hold this forever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            framed = true;
            requestAnimationFrame(resolve);
          });
        }),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(unsettled()),
            Math.max(0, deadline - performance.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const now = read();
    if (now === seen) return now;
    seen = now;
    if (performance.now() >= deadline) throw unsettled();
  }
}
