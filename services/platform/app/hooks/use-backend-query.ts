import type { Query, UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

import {
  activeOrganizationId,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
  type AdaptedReadOptions,
} from '@/app/lib/backend/adapters';
import type { ArgsOf, QueryName, ReturnsOf } from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';

import { useSessionProbeSignedIn } from './use-session-probe';

interface ConvexQueryOptions<TData = unknown> {
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
  /**
   * Gate the query on the session probe holding a user. Defaults to `true`,
   * so authenticated queries never fire during the cold-load auth gap. Set
   * `false` only for queries that MUST run before auth — the `getCurrentUser`
   * probe and genuinely public reads. Adapted reads ignore this gate entirely:
   * they authenticate with the session cookie, which the browser sends anyway,
   * and do not subscribe to the probe.
   */
  requireAuth?: boolean;
  /**
   * What to show while a new key's first answer is pending — react-query's
   * `placeholderData`, handed the last answer this hook showed and the query
   * it came from. The result says `isPlaceholderData`, and a failed read
   * drops the placeholder, so it never stands in for an answer.
   */
  placeholderData?: (
    previousData: TData | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
  ) => TData | undefined;
}

/** `'skip'` stands in for the args when a read is not ready to run yet — the
 *  hook stays mounted (stable hook order) and answers nothing. */
type QueryArgs<Name extends QueryName> =
  Record<string, never> extends ArgsOf<Name>
    ? [
        args?: ArgsOf<Name> | 'skip',
        options?: ConvexQueryOptions<ReturnsOf<Name>>,
      ]
    : [
        args: ArgsOf<Name> | 'skip',
        options?: ConvexQueryOptions<ReturnsOf<Name>>,
      ];

/** The row's poll for react-query: one the last answer decides reads the
 * fetched body, before any `select`. */
function adaptedRefetchInterval(
  adapted: AdaptedReadOptions,
): number | ((query: Query) => number | false) | undefined {
  const interval = adapted.refetchInterval;
  return typeof interval === 'function'
    ? (query) => interval(query.state.data)
    : interval;
}

/**
 * A backend read, addressed by its contract name. The adapter row keyed by
 * that same name serves it over HTTP; a name with no row has no server left
 * to reach and rejects loudly (see `missing-row.ts`).
 */
export function useBackendQuery<Name extends QueryName>(
  name: Name,
  ...[args, options]: QueryArgs<Name>
): UseQueryResult<ReturnsOf<Name>> {
  // `requireAuth` is our own gate, not a react-query option — peel it off.
  const { requireAuth = true, ...queryOpts } = options ?? {};

  // No memo needed: react-query hashes queryKey by VALUE, so rebuilding the
  // options object every render never refetches.
  const adapter = READ_ADAPTERS[name];
  const skipped = args === 'skip';
  // Only the no-row branch below reads the probe, so only it listens. One
  // probe observer per adapted read put an observer per mounted read on the
  // probe's shared query, and each removal scans all of them (#4062).
  const gateOpen = useSessionProbeSignedIn(
    adapter === undefined && !skipped && requireAuth,
  );
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
              ? { refetchInterval: adaptedRefetchInterval(adapted) }
              : {}),
            ...(adapted.select !== undefined ? { select: adapted.select } : {}),
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
    // not fire its refusal before the session probe holds a user.
    enabled =
      !skipped && (requireAuth ? gateOpen : true) && (base.enabled ?? true);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter row and this name's contract entry are keyed alike, so the row's projection IS this return shape
  return useQuery({ ...base, enabled }) as UseQueryResult<ReturnsOf<Name>>;
}

export type { ConvexQueryOptions };
