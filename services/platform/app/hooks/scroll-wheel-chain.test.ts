// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { chainVerticalWheelToScrollParent } from '@/lib/utils/scroll-wheel-chain';

function wheelEvent(deltaY: number): WheelEvent {
  return new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
}

function mockScrollMetrics(
  el: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop = 0,
  }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop?: number;
  },
) {
  let top = scrollTop;
  Object.defineProperty(el, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
    configurable: true,
  });
}

describe('chainVerticalWheelToScrollParent', () => {
  it('scrolls a scrollable ancestor when the container has no vertical overflow', () => {
    const scrollParent = document.createElement('div');
    scrollParent.style.overflow = 'auto';
    mockScrollMetrics(scrollParent, { scrollHeight: 800, clientHeight: 200 });

    const trap = document.createElement('div');
    trap.style.overflowX = 'auto';
    mockScrollMetrics(trap, { scrollHeight: 400, clientHeight: 400 });

    scrollParent.appendChild(trap);
    document.body.appendChild(scrollParent);

    const event = wheelEvent(40);
    chainVerticalWheelToScrollParent(trap, event);

    expect(scrollParent.scrollTop).toBe(40);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing when there is no scrollable ancestor', () => {
    const trap = document.createElement('div');
    trap.style.overflowX = 'auto';
    mockScrollMetrics(trap, { scrollHeight: 400, clientHeight: 400 });
    document.body.appendChild(trap);

    const event = wheelEvent(40);
    chainVerticalWheelToScrollParent(trap, event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores zero vertical delta', () => {
    const scrollParent = document.createElement('div');
    scrollParent.style.overflow = 'auto';
    mockScrollMetrics(scrollParent, { scrollHeight: 800, clientHeight: 200 });

    const trap = document.createElement('div');
    scrollParent.appendChild(trap);
    document.body.appendChild(scrollParent);

    const event = wheelEvent(0);
    chainVerticalWheelToScrollParent(trap, event);

    expect(scrollParent.scrollTop).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });
});
