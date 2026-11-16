import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useViewportVisibility } from './use-viewport-visibility';

function Content() {
  const { ref, isVisible } = useViewportVisibility<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="content">
      {isVisible ? 'near' : 'far'}
    </div>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useViewportVisibility', () => {
  it('gates optional work on intersection and disconnects on unmount', () => {
    let notify: IntersectionObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const constructor = vi.fn(function (
      callback: IntersectionObserverCallback,
    ) {
      notify = callback;
      return { observe, disconnect };
    });
    vi.stubGlobal('IntersectionObserver', constructor);
    const { unmount } = render(<Content />);
    const element = screen.getByTestId('content');
    expect(element).toHaveTextContent('far');
    expect(observe).toHaveBeenCalledWith(element);
    expect(constructor).toHaveBeenCalledWith(expect.any(Function), {
      rootMargin: '800px',
    });

    act(() =>
      notify(
        [
          {
            target: element,
            isIntersecting: true,
            boundingClientRect: element.getBoundingClientRect(),
            intersectionRect: element.getBoundingClientRect(),
            intersectionRatio: 1,
            rootBounds: null,
            time: 0,
          },
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(element).toHaveTextContent('near');
    act(() =>
      notify(
        [
          {
            target: element,
            isIntersecting: false,
            boundingClientRect: element.getBoundingClientRect(),
            intersectionRect: element.getBoundingClientRect(),
            intersectionRatio: 0,
            rootBounds: null,
            time: 0,
          },
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(element).toHaveTextContent('far');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('allows decoration when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Content />);
    expect(screen.getByTestId('content')).toHaveTextContent('near');
  });
});
