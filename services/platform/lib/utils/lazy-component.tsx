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
export function lazyComponent<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
  options: LazyComponentOptions = {},
): T {
  const LazyComponent = lazy(importFn);

  const WrappedComponent = ((props: Parameters<T>[0]) => (
    <Suspense fallback={options.loading?.() ?? null}>
      <LazyComponent {...(props as object)} />
    </Suspense>
  )) as unknown as T;

  return WrappedComponent;
}
