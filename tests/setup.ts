import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver;

// matchMedia (reduced motion, dark mode, breakpoints)
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

// jsdom has no layout: scrolling APIs are absent.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();

// Pointer capture APIs for Radix UI components (Select, Slider, …).
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

// Blob.text() / Blob.arrayBuffer() are missing in jsdom (file upload tests).
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function () {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readAsText always yields a string
        resolve(reader.result as string);
      });
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsText(this);
    });
  };
}
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readAsArrayBuffer always yields an ArrayBuffer
        resolve(reader.result as ArrayBuffer);
      });
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsArrayBuffer(this);
    });
  };
}

// Canvas stub so axe-core's icon-ligature detection does not throw.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  measureText: vi.fn(() => ({ width: 0 })),
  fillText: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({ data: [] })),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial 2D context stub
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
