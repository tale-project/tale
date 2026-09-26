import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSlidingIndicator } from './use-sliding-indicator';

// jsdom lays nothing out: give each element the box a browser would.
function box(element: Element, rect: Partial<DOMRect>) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

function Probe({ active }: { active: string | null }) {
  const indicator = useSlidingIndicator<HTMLDivElement>(active);
  return (
    <div
      data-testid="container"
      ref={(node) => {
        if (node !== null) {
          box(node, { top: 100, left: 10 });
          for (const item of Array.from(node.querySelectorAll('button'))) {
            const index = Number(item.dataset.index);
            box(item, {
              top: 100 + index * 40,
              left: 10,
              width: 36,
              height: 36,
            });
          }
        }
        indicator.containerRef(node);
      }}
    >
      <span data-testid="indicator" style={indicator.style} />
      {['a', 'b', 'c'].map((key, index) => (
        <button
          key={key}
          type="button"
          data-index={index}
          data-indicator-key={key}
        />
      ))}
    </div>
  );
}

describe('useSlidingIndicator', () => {
  it('stays hidden while nothing is active', () => {
    const { getByTestId } = render(<Probe active={null} />);
    expect(getByTestId('indicator').style.opacity).toBe('0');
  });

  it('sits on the active item, measured against its container', () => {
    const { getByTestId } = render(<Probe active="b" />);
    const indicator = getByTestId('indicator');
    expect(indicator.style.opacity).toBe('1');
    expect(indicator.style.transform).toBe('translate3d(0px, 40px, 0)');
    expect(indicator.style.width).toBe('36px');
    expect(indicator.style.height).toBe('36px');
  });

  it('moves with the active key', () => {
    const { getByTestId, rerender } = render(<Probe active="a" />);
    expect(getByTestId('indicator').style.transform).toBe(
      'translate3d(0px, 0px, 0)',
    );
    act(() => {
      rerender(<Probe active="c" />);
    });
    expect(getByTestId('indicator').style.transform).toBe(
      'translate3d(0px, 80px, 0)',
    );
  });
});
