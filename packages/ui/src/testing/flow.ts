/**
 * Waits for a React Flow view to come to rest, for browser tests
 * (`*.browser.test.tsx`) that measure a canvas after it pans or zooms.
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
 * milliseconds (5 s by default) have passed and the view is still moving,
 * it rejects, naming the last transform it read.
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
  for (;;) {
    // Two frames, so the ease has stepped at least once between the reads
    // whichever order a frame runs its callbacks in.
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const now = read();
    if (now === seen) return now;
    seen = now;
    if (performance.now() >= deadline) {
      throw new Error(
        `React Flow viewport never came to rest within ${timeout} ms (last transform: ${seen})`,
      );
    }
  }
}
