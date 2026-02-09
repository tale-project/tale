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

export function lazyComponent<
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Generic component wrapper requires flexible prop types for lazy loading arbitrary components
  importFn: () => Promise<{ default: ComponentType<any> }>,
  options: LazyComponentOptions = {},
): ComponentType<P> {
  const LazyComponent = lazy(importFn);

  const WrappedComponent = (props: P) => (
    <Suspense fallback={options.loading?.() ?? null}>
      {/* Generic P doesn't extend object — cast required for JSX spread */}
      <LazyComponent {...(props as object)} />
    </Suspense>
  );

  return WrappedComponent;
}
