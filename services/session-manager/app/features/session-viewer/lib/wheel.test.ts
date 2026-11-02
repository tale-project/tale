import { describe, expect, it } from 'vitest';

import { LINE_HEIGHT, WheelAccumulator, wheelPixels } from './wheel';

describe('wheelPixels', () => {
  it('takes a wheel that turns in pixels as it is', () => {
    expect(wheelPixels({ deltaX: 3, deltaY: -40, deltaMode: 0 }, 900)).toEqual({
      dx: 3,
      dy: -40,
    });
  });

  it('turns lines into pixels', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 900)).toEqual({
      dx: 0,
      dy: 3 * LINE_HEIGHT,
    });
  });

  it('turns pages into the height of the viewport', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 900)).toEqual({
      dx: 0,
      dy: 900,
    });
    expect(wheelPixels({ deltaX: 1, deltaY: -2, deltaMode: 2 }, 700)).toEqual({
      dx: 700,
      dy: -1400,
    });
  });
});

describe('WheelAccumulator', () => {
  it('has nothing to take at first', () => {
    const wheel = new WheelAccumulator();
    expect(wheel.pending).toBe(false);
    expect(wheel.take()).toBeNull();
  });

  it('adds up what came in a frame and keeps the place of the last event', () => {
    const wheel = new WheelAccumulator();
    wheel.add(10, 20, 0, 30);
    wheel.add(12, 22, 5, -10);
    wheel.add(14, 24, 0, 40);
    expect(wheel.pending).toBe(true);
    expect(wheel.take()).toEqual({ x: 14, y: 24, dx: 5, dy: 60 });
  });

  it('starts again after it was taken', () => {
    const wheel = new WheelAccumulator();
    wheel.add(1, 2, 3, 4);
    wheel.take();
    expect(wheel.pending).toBe(false);
    wheel.add(5, 6, 7, 8);
    expect(wheel.take()).toEqual({ x: 5, y: 6, dx: 7, dy: 8 });
  });
});
