'use client';

import {
  useRouter,
  type NavigateOptions,
  type RegisteredRouter,
} from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * Returns a stable function that preloads a route via router.preloadRoute.
 * Use this for programmatic navigation paths (e.g. row clicks, button handlers)
 * that cannot use TanStack Router's <Link preload="..."> directly.
 *
 * The returned function is generic — TypeScript narrows params from the `to`
 * string exactly like navigate() and <Link>, giving full route type safety.
 */
export function usePreloadRoute() {
  const router = useRouter();
  return useCallback(
    <TFrom extends string = string, TTo extends string | undefined = undefined>(
      options: NavigateOptions<RegisteredRouter, TFrom, TTo>,
    ) => {
      void router.preloadRoute(options);
    },
    [router],
  );
}
