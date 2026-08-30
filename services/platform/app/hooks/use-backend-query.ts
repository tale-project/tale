import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

import {
  activeOrganizationId,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
} from '@/app/lib/backend/adapters';
import type { ArgsOf, QueryName, ReturnsOf } from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';

import { useSessionUser } from './use-session-user';

interface ConvexQueryOptions {
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
  /**
   * Gate the query on the session probe having resolved. Defaults to `true`,
   * so authenticated queries never fire during the cold-load auth gap. Set
   * `false` only for queries that MUST run before auth — the `getCurrentUser`
   * probe and genuinely public reads. Adapted reads ignore this gate entirely:
   * they authenticate with the session cookie, which the browser sends anyway.
   */
  requireAuth?: boolean;
}

/** `'skip'` stands in for the args when a read is not ready to run yet — the
 *  hook stays mounted (stable hook order) and answers nothing. */
type QueryArgs<Name extends QueryName> =
  Record<string, never> extends ArgsOf<Name>
    ? [args?: ArgsOf<Name> | 'skip', options?: ConvexQueryOptions]
    : [args: ArgsOf<Name> | 'skip', options?: ConvexQueryOptions];

/**
 * A backend read, addressed by its contract name. The adapter row keyed by
 * that same name serves it over HTTP; a name with no row has no server left
 * to reach and rejects loudly (see `missing-row.ts`).
 */
export function useBackendQuery<Name extends QueryName>(
  name: Name,
  ...[args, options]: QueryArgs<Name>
): UseQueryResult<ReturnsOf<Name>> {
  const { isAuthenticated } = useSessionUser();
  // `requireAuth` is our own gate, not a react-query option — peel it off.
  const { requireAuth = true, ...queryOpts } = options ?? {};

  // No memo needed: react-query hashes queryKey by VALUE, so rebuilding the
  // options object every render never refetches.
  const adapter = READ_ADAPTERS[name];
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
            queryKey: ['backend-skip', name],
            queryFn: () => Promise.resolve(null),
          };
    enabled = adapted !== null && (base.enabled ?? true);
  } else {
    // No row, no server: the Convex runtime is retired, so this fails loudly
    // (named, so the missing registry key is obvious) instead of hanging on
    // a socket that will never open.
    base = {
      queryKey: ['convex-retired', name],
      queryFn: () => Promise.reject(new MissingBackendRowError(name)),
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter row and this name's contract entry are keyed alike, so the row's projection IS this return shape
  return useQuery({ ...base, enabled }) as UseQueryResult<ReturnsOf<Name>>;
}

export type { ConvexQueryOptions };
