import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSwapFade } from './use-swap-fade';

// jsdom plays no animations: record what the hook asks the node to play.
const animate = vi.fn(() => ({ cancel: vi.fn() }));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
});

afterEach(() => {
  animate.mockClear();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- remove the test's stand-in again
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

function View({
  item,
  fromEmpty,
}: {
  item: string | undefined;
  fromEmpty?: boolean;
}) {
  const ref = useSwapFade<HTMLDivElement>(
    item,
    fromEmpty === undefined ? {} : { fromEmpty },
  );
  return <div ref={ref}>{item}</div>;
}

describe('useSwapFade', () => {
  it('never fades the first render', () => {
    render(<View item="a" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('fades when another item opens in place', () => {
    const { rerender } = render(<View item="a" />);
    rerender(<View item="b" />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<View item="b" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('does not fade to "nothing open"', () => {
    const { rerender } = render(<View item="a" />);
    rerender(<View item={undefined} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('can leave an item born in place unfaded', () => {
    const { rerender } = render(<View item={undefined} fromEmpty={false} />);
    rerender(<View item="new" fromEmpty={false} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<View item="other" fromEmpty={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
