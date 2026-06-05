import { convexQuery } from '@convex-dev/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useConvexAuth } from 'convex/react';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

type EmptyObject = Record<string, never>;

interface ConvexQueryOptions {
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
  /**
   * Gate the query on the Convex WebSocket auth being established. Defaults to
   * `true`, so authenticated queries never fire during the cold-load auth gap
   * (which otherwise surfaces as `UnauthorizedError`). Set `false` only for
   * queries that MUST run before auth — the `getCurrentUser` auth probe and
   * genuinely public/marketing reads. Pre-auth queries left gated would hang.
   */
  requireAuth?: boolean;
}

type QueryArgs<Func extends FunctionReference<'query'>> =
  keyof FunctionArgs<Func> extends never
    ? [args?: EmptyObject | 'skip', options?: ConvexQueryOptions]
    : EmptyObject extends FunctionArgs<Func>
      ? [args?: FunctionArgs<Func> | 'skip', options?: ConvexQueryOptions]
      : [args: FunctionArgs<Func> | 'skip', options?: ConvexQueryOptions];

export function useConvexQuery<Func extends FunctionReference<'query'>>(
  func: Func,
  ...[args, options]: QueryArgs<Func>
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- FunctionReturnType<Func> is not the default (unknown)
): UseQueryResult<FunctionReturnType<Func>> {
  const { isAuthenticated } = useConvexAuth();
  // `requireAuth` is our own gate, not a react-query option — peel it off.
  const { requireAuth = true, ...queryOpts } = options ?? {};
  // convexQuery returns a conditional type that useQuery can't resolve in generic context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: any = { ...convexQuery(func, args ?? {}), ...queryOpts };
  // Fold auth-gating into the effective `enabled` while preserving whatever it
  // would have been (caller `enabled:false` / `'skip'` from convexQuery still
  // win). Default-on gating means callers can't forget to wait for auth.
  const enabled =
    (requireAuth ? isAuthenticated : true) && (base.enabled ?? true);
  return useQuery({ ...base, enabled });
}

export type { ConvexQueryOptions };
