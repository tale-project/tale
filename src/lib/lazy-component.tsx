'use client';

// oxlint-disable typescript/no-explicit-any -- React.lazy uses ComponentType<any> internally; we need the same flexibility for dynamic imports with named exports

import {
  forwardRef,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from 'react';

interface LazyComponentOptions {
  loading?: () => ReactNode;
}

/**
 * Creates a lazily loaded component with optional loading fallback.
 *
 * @param importFn - Dynamic import function returning the component
 * @param options - Configuration options including loading fallback
 * @returns A wrapped component that lazy loads the actual component
 */
export function lazyComponent<P extends Record<string, any>, R = unknown>(
  importFn: () => Promise<{ default: ComponentType<any> }>,
  options: LazyComponentOptions = {},
) {
  const LazyComponent = lazy(importFn);

  // forwardRef so callers can grab imperative handles (`useRef` +
  // `useImperativeHandle`) on the underlying component — without it, the
  // Suspense wrapper would swallow the ref.
  return forwardRef<R, P>(function LazyComponentWrapper(props, ref) {
    return (
      <Suspense fallback={options.loading?.() ?? null}>
        <LazyComponent {...props} ref={ref} />
      </Suspense>
    );
  });
}
