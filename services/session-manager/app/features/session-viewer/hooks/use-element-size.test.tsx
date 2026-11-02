import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ControlledResizeObserver,
  stubLayout,
  type Room,
} from '@/tests/utils/live-view';

import { useElementSize } from './use-element-size';

function Sized() {
  const { ref, size } = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="box">
      {size.width} x {size.height}
    </div>
  );
}

let room: Room;

beforeEach(() => {
  ControlledResizeObserver.install();
  room = { width: 640, height: 480 };
  stubLayout(() => room);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useElementSize', () => {
  it('measures the element before anyone sees it', () => {
    render(<Sized />);
    expect(screen.getByTestId('box')).toHaveTextContent('640 x 480');
  });

  it('measures it again when it is resized', () => {
    render(<Sized />);
    room = { width: 300, height: 200 };
    act(() => ControlledResizeObserver.resizeAll());
    expect(screen.getByTestId('box')).toHaveTextContent('300 x 200');
  });

  it('keeps what it has when a resize changed nothing', () => {
    render(<Sized />);
    const before = screen.getByTestId('box').textContent;
    act(() => ControlledResizeObserver.resizeAll());
    expect(screen.getByTestId('box').textContent).toBe(before);
  });

  it('watches the element, and lets go of it when it is gone', () => {
    const { unmount } = render(<Sized />);
    const [observer] = ControlledResizeObserver.instances;
    expect(observer?.observe).toHaveBeenCalledWith(screen.getByTestId('box'));
    unmount();
    expect(observer?.disconnect).toHaveBeenCalled();
  });

  it('is zero without layout', () => {
    stubLayout(() => ({ width: 0, height: 0 }));
    render(<Sized />);
    expect(screen.getByTestId('box')).toHaveTextContent('0 x 0');
  });
});
