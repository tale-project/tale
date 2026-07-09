'use client';

/**
 * Generic, capability-gated reactive read. Binds a view to ANY public Convex
 * query the automation declared in `capabilities.functions`, by reference path — an
 * open allowlist of function paths, not a fixed set of named data-sources. The
 * allowlist is checked before subscribing; a disallowed/invalid path resolves to
 * `blocked` (and skips the subscription) rather than calling anything.
 */
import { makeFunctionReference } from 'convex/server';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import {
  bindingArgsResolved,
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';

import { useAutomationRuntime } from '../runtime/automation-runtime';
import { useOptionalViewState } from '../runtime/view-state';

/** See `useBoundAction` — optional bindings pass `''` and must not crash hooks. */
const NOOP_FUNCTION_PATH = '_noop/_noop:_noop';

export interface BoundQueryResult {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  /** The path was not in the automation's allowlist (or malformed) — nothing was called. */
  blocked: boolean;
  /** A `$config:`/`$state.` (or other) binding the args reference is still
   *  unset, so no call fired. Blocks that bind `$state.` decide whether this
   *  reads as "needs configuration" or "awaiting selection". */
  needsConfig: boolean;
}

export function useBoundQuery(path: string, args: unknown): BoundQueryResult {
  const { organizationId, projectId, allowlist, config } =
    useAutomationRuntime();
  const viewState = useOptionalViewState();
  const pathOk = isValidFunctionPath(path);
  const allowed = pathOk && isFunctionAllowed(path, allowlist, 'query');

  const ref = makeFunctionReference<'query'>(
    pathOk ? path : NOOP_FUNCTION_PATH,
  );
  const resolvedArgs = resolveBindingArgs(args ?? {}, {
    organizationId,
    projectId,
    config,
    state: viewState?.state,
  });
  // An unset `$config:`/`$state.` reference resolves to `undefined`; gate on a
  // fully-bound result so the block shows a prompt instead of firing a call
  // that fails arg validation — same posture as `useBoundPaginatedQuery`.
  const ready = bindingArgsResolved(resolvedArgs);
  // Hooks run unconditionally; `'skip'` means no subscription when disallowed.
  const q = useConvexQuery(ref, allowed && ready ? resolvedArgs : 'skip');

  return {
    data: q.data,
    isLoading: allowed && ready ? q.isLoading : false,
    error: q.error,
    blocked: !allowed,
    needsConfig: allowed && !ready,
  };
}
