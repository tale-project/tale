import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRowWaker } from './use-row-wake';

/** An IntersectionObserver the test drives (jsdom has none that reports). */
class ControlledObserver {
  static instances: ControlledObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    ControlledObserver.instances.push(this);
  }
  get root() {
    return this.options.root ?? null;
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  report(target: Element, isIntersecting: boolean) {
    const entry = { target, isIntersecting };
    this.callback(
      [entry as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/** An element laid out at `top`..`top + height` (viewport coordinates). */
function box(top: number, height: number, clientHeight = 0): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height }) as DOMRect;
  Object.defineProperty(element, 'clientHeight', { value: clientHeight });
  return element;
}

describe('createRowWaker', () => {
  beforeEach(() => {
    ControlledObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', ControlledObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes rows registered before the log was attached once it syncs', () => {
    let root: HTMLElement | null = null;
    const waker = createRowWaker(() => root);
    const row = box(-5000, 200);
    waker.watch(row, vi.fn());
    expect(ControlledObserver.instances).toHaveLength(0);

    root = box(0, 600, 600);
    waker.sync();

    const [observer] = ControlledObserver.instances;
    expect(observer?.root).toBe(root);
    expect(observer?.options.rootMargin).toBe('300% 0px');
    expect(observer?.targets.has(row)).toBe(true);
  });

  it('wakes, before paint, the new rows within a log height of the view', () => {
    const root = box(100, 600, 600);
    const waker = createRowWaker(() => root);
    const inView = vi.fn();
    const justAbove = vi.fn();
    const farAbove = vi.fn();
    const farBelow = vi.fn();
    waker.watch(box(300, 200), inView);
    waker.watch(box(-450, 200), justAbove);
    waker.watch(box(-1200, 200), farAbove);
    waker.watch(box(1350, 200), farBelow);

    waker.sync();

    expect(inView).toHaveBeenCalledWith(true);
    expect(justAbove).toHaveBeenCalledWith(true);
    expect(farAbove).not.toHaveBeenCalled();
    expect(farBelow).not.toHaveBeenCalled();
  });

  it('measures only the rows registered since the last sync', () => {
    const root = box(0, 600, 600);
    const waker = createRowWaker(() => root);
    const row = box(-2000, 200);
    const wake = vi.fn();
    waker.watch(row, wake);
    waker.sync();
    // Scrolled into view since: waking it is the observer's job now.
    row.getBoundingClientRect = () =>
      ({ top: 100, bottom: 300, height: 200 }) as DOMRect;

    waker.sync();

    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes a row the observer reports near, once, in the background', () => {
    const root = box(0, 600, 600);
    const waker = createRowWaker(() => root);
    const row = box(-3000, 200);
    const wake = vi.fn();
    waker.watch(row, wake);
    waker.sync();
    const [observer] = ControlledObserver.instances;

    observer?.report(row, false);
    expect(wake).not.toHaveBeenCalled();
    observer?.report(row, true);
    observer?.report(row, true);

    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(false);
    expect(observer?.targets.has(row)).toBe(false);
  });

  it('forgets an unregistered row', () => {
    const root = box(0, 600, 600);
    const waker = createRowWaker(() => root);
    const row = box(-3000, 200);
    const wake = vi.fn();
    const unwatch = waker.watch(row, wake);
    waker.sync();
    const [observer] = ControlledObserver.instances;

    unwatch();
    observer?.report(row, true);

    expect(wake).not.toHaveBeenCalled();
    expect(observer?.targets.has(row)).toBe(false);
  });

  it('moves its rows to a new observer when the log node is replaced', () => {
    let root = box(0, 600, 600);
    const waker = createRowWaker(() => root);
    const row = box(-3000, 200);
    waker.watch(row, vi.fn());
    waker.sync();

    root = box(0, 600, 600);
    waker.sync();

    const [first, second] = ControlledObserver.instances;
    expect(first?.targets.size).toBe(0);
    expect(second?.root).toBe(root);
    expect(second?.targets.has(row)).toBe(true);
  });

  it('wakes every row where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = box(0, 600, 600);
    const waker = createRowWaker(() => root);
    const wake = vi.fn();
    waker.watch(box(-9000, 200), wake);

    waker.sync();

    expect(wake).toHaveBeenCalledWith(true);
  });
});
