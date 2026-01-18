'use client';

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyComponent<P = any>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importFn: () => Promise<{ default: ComponentType<any> }>,
  options: LazyComponentOptions = {},
): ComponentType<P> {
  const LazyComponent = lazy(importFn);

  const WrappedComponent = (props: P) => (
    <Suspense fallback={options.loading?.() ?? null}>
      <LazyComponent {...(props as object)} />
    </Suspense>
  );

  return WrappedComponent;
}
