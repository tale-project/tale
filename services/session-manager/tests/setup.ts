import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Initialise this service's i18n instance as a side-effect so components that
// call `useT(...)` render real copy in unit tests instead of raw keys. The
// bundle layers `@tale/ui` under the service's own catalogs, exactly as the
// browser does.
import '@/lib/i18n/i18n';

afterEach(() => {
  cleanup();
  // The toast store outlives a test; dismissing the toast of the test that
  // ends keeps it from reading as the next test's.
  toast({}).dismiss();
});

// jsdom performs no layout and ships none of the observer APIs the shared
// components reach for. Mirrors `packages/ui/tests/setup.ts` (which is not
// exported).

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver;

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly scrollMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn((): IntersectionObserverEntry[] => []);
}
global.IntersectionObserver = MockIntersectionObserver;

// `matchMedia` drives the theme provider and `framer-motion`'s reduced-motion
// hook. A test that needs a specific breakpoint stubs it locally.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Scrolling APIs are absent without layout.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();

// Radix (dialog, dropdown) reads pointer capture during interaction.
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

// Canvas stub so axe-core's icon-ligature detection does not throw.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value: vi.fn(() => ({
    measureText: vi.fn(() => ({ width: 0 })),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: [] })),
  })),
});
