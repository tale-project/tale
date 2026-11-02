// Gives one element a width in jsdom, which lays nothing out, and lets a test
// resize it: what `useFitsWidth` reads (the element's measure at first, and the
// sizes its ResizeObserver reports after).

import { vi } from 'vitest';

function rectOf(width: number): DOMRect {
  return {
    width,
    height: width === 0 ? 0 : 600,
    top: 0,
    left: 0,
    right: width,
    bottom: width === 0 ? 0 : 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function entryOf(target: Element, width: number): ResizeObserverEntry {
  return {
    target,
    contentRect: rectOf(width),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  };
}

/** A `ResizeObserver` that remembers what it watches and says so when told. */
class RecordingObserver implements ResizeObserver {
  static all: RecordingObserver[] = [];
  readonly targets: Element[] = [];
  unobserve = vi.fn();
  disconnect = vi.fn();
  observe = vi.fn((target: Element) => {
    this.targets.push(target);
  });

  constructor(private readonly callback: ResizeObserverCallback) {
    RecordingObserver.all.push(this);
  }

  /** Tells whoever made this observer that these were resized. */
  notify(entries: ResizeObserverEntry[]) {
    this.callback(entries, this);
  }
}

/**
 * Makes the elements `isTarget` says yes to `width` px wide, and returns what
 * resizes them: `resize(width)` tells whoever watches them, as the browser does.
 * `restore` puts everything back; call it after the test (`afterEach`).
 */
export function stubWidth(
  isTarget: (element: Element) => boolean,
  width: number,
) {
  let current = width;
  RecordingObserver.all = [];
  vi.stubGlobal('ResizeObserver', RecordingObserver);
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return rectOf(isTarget(this) ? current : 0);
    });

  return {
    /** The observers the page made, in the order it made them. */
    get observers(): readonly RecordingObserver[] {
      return RecordingObserver.all;
    },
    /** The box is this wide from now on, and its watchers are told. */
    resize(next: number) {
      current = next;
      for (const observer of RecordingObserver.all) {
        const targets = observer.targets.filter(isTarget);
        if (targets.length === 0) continue;
        observer.notify(targets.map((target) => entryOf(target, next)));
      }
    },
    restore() {
      rect.mockRestore();
      vi.unstubAllGlobals();
      RecordingObserver.all = [];
    },
  };
}
