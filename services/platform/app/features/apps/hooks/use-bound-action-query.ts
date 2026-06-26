'use client';

/**
 * Generic, capability-gated CACHED read from an action. The read sibling of
 * `useBoundAction` (which is a write seam): same allowlist gate + `$orgId` arg
 * resolution, but routed through TanStack Query (`staleTime: Infinity`) so an
 * action-sourced list loads once and stays warm across remounts — re-entering a
 * tab or the page serves the cache instead of re-hitting the upstream (e.g.
 * GitHub) on every mount. Mirrors `useActionQuery` (the typed catalog/agents
 * precedent) but binds a path dynamically and adds the app allowlist check.
 *
 * Refresh is explicit: callers invoke `refetch()`. The queryKey folds in
 * `organizationId` so two orgs never share a cache entry even though the
 * unresolved args carry the same `$orgId` sentinel.
 */
import { useQuery } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { useMemo } from 'react';

import { isStructuredConvexError } from '@/app/hooks/use-action-query';
import {
  bindingArgsResolved,
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';

import { useAppRuntime } from '../runtime/app-runtime';

export interface BoundActionQueryResult {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  /** The path was not in the app's allowlist (or malformed) — nothing was called. */
  blocked: boolean;
  /** A `$config:` (or other) binding the args reference is still unset, so no
   *  call fired — the app needs configuration before this list can load. */
  needsConfig: boolean;
}

export function useBoundActionQuery(
  path: string,
  args: unknown,
): BoundActionQueryResult {
  const { organizationId, projectId, allowlist, labels, config } =
    useAppRuntime();
  const { isAuthenticated } = useConvexAuth();
  const allowed =
    isValidFunctionPath(path) && isFunctionAllowed(path, allowlist, 'action');

  // Hooks run unconditionally; `enabled` (not the ref) gates the actual call.
  const action = useAction(makeFunctionReference<'action'>(path));
  const argsKey = JSON.stringify(args ?? {});
  // Resolved args embed config values (e.g. owner/repo), so a config change must
  // bust the cache — fold it into the key.
  const configKey = JSON.stringify(config ?? {});

  // Resolve once for both the gate and the call. An unset `$config:` reference
  // resolves to `undefined`; gate on a fully-bound result so an unconfigured app
  // shows an empty state instead of firing a request that fails arg validation.
  const resolved = useMemo(
    () =>
      resolveBindingArgs(args ?? {}, {
        organizationId,
        projectId,
        labels,
        config,
      }),
    // argsKey/configKey stand in for the structurally-compared args + config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [argsKey, configKey, organizationId, projectId, labels],
  );
  const ready = bindingArgsResolved(resolved);

  const query = useQuery({
    // projectId folded in alongside organizationId so two projects never share a
    // cache entry even though the unresolved args carry the same sentinels.
    queryKey: [
      'bound-action-query',
      path,
      organizationId,
      projectId,
      argsKey,
      configKey,
    ],
    queryFn: () => action(resolved),
    staleTime: Infinity,
    // ConvexError is deterministic (validation / auth / expected-state) — don't
    // burn ~7s of retry backoff before the UI sees it. Network errors still retry.
    retry: (failureCount, err) =>
      !isStructuredConvexError(err) && failureCount < 3,
    enabled: allowed && isAuthenticated && ready,
  });

  return {
    data: query.data,
    isLoading: allowed && ready ? query.isLoading : false,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
    blocked: !allowed,
    needsConfig: allowed && !ready,
  };
}
