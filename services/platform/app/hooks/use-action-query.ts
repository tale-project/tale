import { useQuery } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { getFunctionName } from 'convex/server';

import {
  ACTION_QUERY_ADAPTERS,
  activeOrganizationId,
  runAdapted,
} from '@/app/lib/backend/convex-adapters';
import { ConvexRetiredError } from '@/app/lib/backend/retired-convex';

import { useConvexAuth } from './use-convex-auth';

interface ActionQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}

/**
 * True iff `err` looks like a Convex `ConvexError` carrying structured `data`.
 * Avoids `instanceof ConvexError` because Vite HMR / chunk splitting can
 * produce multiple copies of the class — the prototype-chain check then
 * fails even though the error IS a ConvexError. Structural shape is what
 * the UI actually consumes, so check that directly.
 */
export function isStructuredConvexError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  if (!('data' in err)) return false;
  const data = err.data;
  return data != null && typeof data === 'object';
}

/**
 * The `code` string from a structured `ConvexError`'s `data`, if present.
 * Lets the UI branch on a backend error kind (e.g. an connector that isn't
 * connected) instead of substring-matching a human message. Returns
 * `undefined` for a plain error or a `data` without a string `code`.
 */
export function convexErrorCode(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  const { data } = err;
  if (data == null || typeof data !== 'object' || !('code' in data)) {
    return undefined;
  }
  return typeof data.code === 'string' ? data.code : undefined;
}

export function useActionQuery<Func extends FunctionReference<'action'>>(
  queryKey: readonly unknown[],
  func: Func,
  args: FunctionArgs<Func>,
  options?: ActionQueryOptions,
) {
  const { isAuthenticated } = useConvexAuth();

  // Every shipped walk is served over HTTP (session cookie, no WebSocket-auth
  // gate) by its adapter row; a ref without one has no server left.
  const fnName = getFunctionName(func);
  const adapter = ACTION_QUERY_ADAPTERS[fnName];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adaptedFetch =
    adapter === undefined
      ? null
      : adapter(
          args ?? {},
          organizationId !== undefined ? { organizationId } : {},
        );

  // The explicit annotation keeps TData = the action's return type on BOTH
  // lanes — an untyped ternary would collapse the inference to `unknown`.
  const queryFn: () => Promise<FunctionReturnType<Func>> =
    adaptedFetch !== null
      ? () => runAdapted(adaptedFetch)
      : () => Promise.reject(new ConvexRetiredError(fnName));

  return useQuery({
    queryKey,
    queryFn,
    staleTime: Infinity,
    // ConvexError is deterministic — server-side validation, auth gate, or
    // expected-state signal (the adapted lane normalizes its 4xx answers to
    // the same shape). Retrying just delays the error reaching the UI
    // (default 3 retries with exponential backoff = ~7 s wait before `error`
    // is exposed). Network errors still retry the default 3 times.
    retry: (failureCount, err) =>
      !isStructuredConvexError(err) && failureCount < 3,
    ...options,
    enabled:
      (adapter !== undefined ? adaptedFetch !== null : isAuthenticated) &&
      (options?.enabled ?? true),
  });
}
