import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { getFunctionName } from 'convex/server';

import {
  activeOrganizationId,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
} from '@/app/lib/backend/convex-adapters';
import { ConvexRetiredError } from '@/app/lib/backend/retired-convex';

import { useConvexAuth } from './use-convex-auth';

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
   * Reads served by the 0.5 backend adapter ignore this gate entirely — they
   * authenticate with the session cookie, not the WebSocket.
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

  // A family migrated to the 0.5 backend serves this read over HTTP — same
  // hook order either way (one useQuery), so the seam is invisible upstream.
  // No memo needed: react-query hashes queryKey by VALUE, so rebuilding the
  // options object every render never refetches.
  const fnName = getFunctionName(func);
  const adapter = READ_ADAPTERS[fnName];
  const skipped = args === 'skip';
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adapterCtx = organizationId !== undefined ? { organizationId } : {};
  const adapted =
    adapter === undefined || skipped ? null : adapter(args ?? {}, adapterCtx);

  // convexQuery returns a conditional type that useQuery can't resolve in generic context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let base: any;
  let enabled: boolean;
  if (adapter !== undefined) {
    base =
      adapted !== null
        ? {
            queryKey: adapted.queryKey,
            queryFn: () => runAdapted(adapted.queryFn),
            ...(adapted.staleTime !== undefined
              ? { staleTime: adapted.staleTime }
              : {}),
            ...(adapted.refetchInterval !== undefined
              ? { refetchInterval: adapted.refetchInterval }
              : {}),
            retry: retryAdaptedRead,
            ...queryOpts,
          }
        : // Skipped (or unservable without an org): a stable inert entry.
          {
            queryKey: ['backend-skip', fnName],
            queryFn: () => Promise.resolve(null),
          };
    enabled = adapted !== null && (base.enabled ?? true);
  } else {
    // No row, no server: the Convex runtime is retired, so this fails loudly
    // (named, so the missing registry key is obvious) instead of hanging on
    // a socket that will never open.
    base = {
      queryKey: ['convex-retired', fnName],
      queryFn: () => Promise.reject(new ConvexRetiredError(fnName)),
      retry: false,
      ...queryOpts,
    };
    // The auth gate still applies: a read that would refuse pre-auth should
    // not fire its refusal before the session probe resolves.
    enabled =
      !skipped &&
      (requireAuth ? isAuthenticated : true) &&
      (base.enabled ?? true);
  }
  return useQuery({ ...base, enabled });
}

export type { ConvexQueryOptions };
