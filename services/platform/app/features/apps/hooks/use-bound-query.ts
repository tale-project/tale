'use client';

/**
 * Generic, capability-gated reactive read. Binds a view to ANY public Convex
 * query the app declared in `capabilities.functions`, by reference path — an
 * open allowlist of function paths, not a fixed set of named data-sources. The
 * allowlist is checked before subscribing; a disallowed/invalid path resolves to
 * `blocked` (and skips the subscription) rather than calling anything.
 */
import { makeFunctionReference } from 'convex/server';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import {
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';

import { useAppRuntime } from '../runtime/app-runtime';

export interface BoundQueryResult {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  /** The path was not in the app's allowlist (or malformed) — nothing was called. */
  blocked: boolean;
}

export function useBoundQuery(path: string, args: unknown): BoundQueryResult {
  const { organizationId, projectId, allowlist, labels } = useAppRuntime();
  const allowed =
    isValidFunctionPath(path) && isFunctionAllowed(path, allowlist, 'query');

  const ref = makeFunctionReference<'query'>(path);
  const resolvedArgs = resolveBindingArgs(args ?? {}, {
    organizationId,
    projectId,
    labels,
  });
  // Hooks run unconditionally; `'skip'` means no subscription when disallowed.
  const q = useConvexQuery(ref, allowed ? resolvedArgs : 'skip');

  return {
    data: q.data,
    isLoading: allowed ? q.isLoading : false,
    error: q.error,
    blocked: !allowed,
  };
}
