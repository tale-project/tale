'use client';

// oxlint-disable typescript/no-explicit-any -- React.lazy uses ComponentType<any> internally; we need the same flexibility for dynamic imports with named exports

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
export function lazyComponent<P extends Record<string, any>>(
  importFn: () => Promise<{ default: ComponentType<any> }>,
  options: LazyComponentOptions = {},
): ComponentType<P> {
  const LazyComponent = lazy(importFn);

  const WrappedComponent = (props: P) => (
    <Suspense fallback={options.loading?.() ?? null}>
      <LazyComponent {...props} />
    </Suspense>
  );

  return WrappedComponent;
}
