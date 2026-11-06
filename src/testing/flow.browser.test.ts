import { afterEach, describe, expect, it, vi } from 'vitest';

import { viewportAtRest } from './flow';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const undo of teardown.splice(0)) undo();
  vi.restoreAllMocks();
});

/** A hand-built canvas: the one element `viewportAtRest` reads. */
function canvas(transform: string) {
  const host = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'react-flow__viewport';
  viewport.style.transform = transform;
  host.append(viewport);
  document.body.append(host);
  teardown.push(() => host.remove());
  return { host, viewport };
}

/** An ease that never ends: a new transform on every frame. */
function keepMoving(viewport: HTMLElement) {
  let x = 0;
  let frame = 0;
  const step = () => {
    x += 1;
    viewport.style.transform = `translate(${x}px, 0px) scale(1)`;
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  teardown.push(() => cancelAnimationFrame(frame));
}

describe('viewportAtRest', () => {
  it('resolves with the transform of a view that holds still', async () => {
    const { host } = canvas('translate(12px, 34px) scale(1.5)');
    await expect(viewportAtRest(host)).resolves.toBe(
      'translate(12px, 34px) scale(1.5)',
    );
  });

  it('gives up on a view that never comes to rest, naming where it was', async () => {
    const { host, viewport } = canvas('translate(0px, 0px) scale(1)');
    keepMoving(viewport);
    await expect(viewportAtRest(host, { timeout: 300 })).rejects.toThrow(
      /^React Flow viewport never came to rest within 300 ms \(last transform: translate\([1-9]\d*px, 0px\) scale\(1\)\)$/,
    );
  });

  it('gives up when no frame comes, naming where the view was and why', async () => {
    const { host } = canvas('translate(12px, 34px) scale(1.5)');
    // A hidden or throttled page draws no frame: the callback never runs.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    await expect(viewportAtRest(host, { timeout: 300 })).rejects.toThrow(
      'React Flow viewport never came to rest within 300 ms (last transform: translate(12px, 34px) scale(1.5); no animation frame ran)',
    );
  });

  // `setTimeout` fires at once for a delay past 2^31 − 1 ms: a timer armed
  // for `Infinity` would reject before the first two frames went by.
  it('waits without a bound when the bound is Infinity', async () => {
    const { host } = canvas('translate(12px, 34px) scale(1.5)');
    await expect(viewportAtRest(host, { timeout: Infinity })).resolves.toBe(
      'translate(12px, 34px) scale(1.5)',
    );
  });

  it('gives up after 5 s when no bound is given', async () => {
    const { host, viewport } = canvas('translate(0px, 0px) scale(1)');
    keepMoving(viewport);
    // A clock that jumps a second at every read, so the default bound runs
    // out within a few frames instead of five real seconds.
    let now = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 1_000));
    await expect(viewportAtRest(host)).rejects.toThrow(
      'React Flow viewport never came to rest within 5000 ms',
    );
  });
});
