import { vi } from 'vitest';

export type Viewport = 'phone' | 'desktop';

// The shell's `md` breakpoint: the query `useIsMobile` asks.
const PHONE_QUERY = '(max-width: 767px)';

/**
 * Makes `window.matchMedia` answer for a phone or a computer (every query but
 * the shell's own answers "no"). `resize` flips it and tells whoever listens,
 * as a window does when it is resized. Call it before rendering.
 */
export function stubViewport(initial: Viewport) {
  let phone = initial === 'phone';
  const listeners = new Set<(event: { matches: boolean }) => void>();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query === PHONE_QUERY && phone;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (
        _type: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        if (query === PHONE_QUERY) listeners.add(listener);
      },
      removeEventListener: (
        _type: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        listeners.delete(listener);
      },
      dispatchEvent: vi.fn(),
    })),
  });
  return {
    resize: (next: Viewport) => {
      phone = next === 'phone';
      for (const listener of listeners) listener({ matches: phone });
    },
  };
}

/**
 * Tells `matchMedia` whether the window is a phone's, for the test that
 * follows (the setup answers "no" to every query). A test that calls it with
 * `true` calls it with `false` once it is done.
 */
export function showPhone(phone: boolean): void {
  stubViewport(phone ? 'phone' : 'desktop');
}
