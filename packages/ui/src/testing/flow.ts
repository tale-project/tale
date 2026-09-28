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
 */
export async function viewportAtRest(
  within: ParentNode = document,
): Promise<string> {
  const read = () => {
    const viewport = within.querySelector<HTMLElement>('.react-flow__viewport');
    if (viewport === null) throw new Error('no React Flow viewport');
    return viewport.style.transform;
  };
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
  }
}
