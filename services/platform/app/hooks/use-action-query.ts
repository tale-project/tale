import { useQuery } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import type { FunctionArgs, FunctionReference } from 'convex/server';

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
function isStructuredConvexError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  if (!('data' in err)) return false;
  const data = (err as { data: unknown }).data;
  return data != null && typeof data === 'object';
}

export function useActionQuery<Func extends FunctionReference<'action'>>(
  queryKey: readonly unknown[],
  func: Func,
  args: FunctionArgs<Func>,
  options?: ActionQueryOptions,
) {
  const action = useAction(func);
  const { isAuthenticated } = useConvexAuth();
  return useQuery({
    queryKey,
    queryFn: () => action(args),
    staleTime: Infinity,
    // ConvexError is deterministic — server-side validation, auth gate, or
    // expected-state signal. Retrying just delays the error reaching the UI
    // (default 3 retries with exponential backoff = ~7 s wait before `error`
    // is exposed). Network errors still retry the default 3 times.
    retry: (failureCount, err) =>
      !isStructuredConvexError(err) && failureCount < 3,
    ...options,
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
}
