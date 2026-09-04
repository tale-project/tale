import { useQuery } from '@tanstack/react-query';

import {
  ACTION_QUERY_ADAPTERS,
  activeOrganizationId,
  runAdapted,
} from '@/app/lib/backend/adapters';
/* oxlint-disable typescript/no-unsafe-type-assertion -- the adapter
   registry is the untyped boundary: a row and the contract entry it
   serves are keyed by the SAME name, so the row's projection IS that
   name's return shape. */
import type {
  ArgsOf,
  BackendName,
  ReturnsOf,
} from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';

import { useSessionUser } from './use-session-user';

interface ActionQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}

/**
 * True iff `err` looks like a Convex `AppError` carrying structured `data`.
 * Avoids `instanceof AppError` because Vite HMR / chunk splitting can
 * produce multiple copies of the class — the prototype-chain check then
 * fails even though the error IS a AppError. Structural shape is what
 * the UI actually consumes, so check that directly.
 */
export function isStructuredBackendError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  if (!('data' in err)) return false;
  const data = err.data;
  return data != null && typeof data === 'object';
}

/**
 * The `code` string from a structured `AppError`'s `data`, if present.
 * Lets the UI branch on a backend error kind (e.g. a connector that isn't
 * connected) instead of substring-matching a human message. Returns
 * `undefined` for a plain error or a `data` without a string `code`.
 */
export function backendErrorCode(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  const { data } = err;
  if (data == null || typeof data !== 'object' || !('code' in data)) {
    return undefined;
  }
  return typeof data.code === 'string' ? data.code : undefined;
}

/**
 * A READ served by a write-shaped backend call (the 0.4 `action` lane), keyed
 * by the caller's own queryKey. The adapter row supplies the fetch.
 */
export function useActionQuery<Name extends BackendName>(
  queryKey: readonly unknown[],
  name: Name,
  args: ArgsOf<Name>,
  options?: ActionQueryOptions,
) {
  const { isAuthenticated } = useSessionUser();

  // Every shipped walk is served over HTTP (session cookie, no WebSocket-auth
  // gate) by its adapter row; a name without one has no server left.
  const adapter = ACTION_QUERY_ADAPTERS[name];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adaptedFetch =
    adapter === undefined
      ? null
      : adapter(
          args ?? {},
          organizationId !== undefined ? { organizationId } : {},
        );

  // The explicit annotation keeps TData = the contract's return type on BOTH
  // lanes — an untyped ternary would collapse the inference to `unknown`.
  const queryFn: () => Promise<ReturnsOf<Name>> =
    adaptedFetch !== null
      ? () => runAdapted(adaptedFetch) as Promise<ReturnsOf<Name>>
      : () => Promise.reject(new MissingBackendRowError(name));

  return useQuery({
    queryKey,
    queryFn,
    staleTime: Infinity,
    // AppError is deterministic — server-side validation, auth gate, or
    // expected-state signal (the adapted lane normalizes its 4xx answers to
    // the same shape). Retrying just delays the error reaching the UI
    // (default 3 retries with exponential backoff = ~7 s wait before `error`
    // is exposed). Network errors still retry the default 3 times.
    retry: (failureCount, err) =>
      !isStructuredBackendError(err) && failureCount < 3,
    ...options,
    enabled:
      (adapter !== undefined ? adaptedFetch !== null : isAuthenticated) &&
      (options?.enabled ?? true),
  });
}
