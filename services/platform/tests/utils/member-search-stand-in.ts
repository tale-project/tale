import type {
  FoundMember,
  MemberSearch,
} from '@/app/features/settings/organization/hooks/member-search';

import type { StandInMember } from './member-lookup-stand-in';

/** What a test's screen asked the member search for. */
export interface StandInSearchAsk {
  query: string;
  access?: 'read' | 'edit';
  projectId?: string;
  enabled?: boolean;
}

function foundMember(member: StandInMember, index: number): FoundMember {
  return {
    _id: `member-${member.userId}`,
    userId: member.userId,
    role: member.role ?? 'member',
    createdAt: index,
    displayName: member.displayName,
    email: member.email,
  } as FoundMember;
}

/** A search that failed, as a test stages it. */
export interface StandInSearchFailure {
  /** While `members()` is undefined, whether the search failed rather than
   * still running. */
  failed?: () => boolean;
  /** While `members()` answers, whether its latest refresh failed: the list
   * shown is the last answer. */
  stale?: () => boolean;
  /** Whether a request runs again while the failure stands. */
  retrying?: () => boolean;
  /** The error the failed search settled in. */
  error?: () => unknown;
  /** What **Try again** on the failure notice calls. */
  retry?: () => void;
}

/**
 * Stand-in for the member search (`member-search.ts`), for a test that serves
 * `GET /members/search` from a list: the search finds the members in
 * `members()` whose name or email holds what is typed, leaving the disabled
 * ones out for `access: 'read'`, as the server does. Whom the screen searched
 * for is pushed onto `asks`. While `members()` is undefined the search has not
 * answered.
 *
 * Mock the module with it from a hoisted factory, next to the lookup stand-in:
 *
 * ```ts
 * vi.mock('@/app/features/settings/organization/hooks/member-search', async () =>
 *   (await import('@/tests/utils/member-search-stand-in')).memberSearchStandIn(
 *     () => state.members,
 *   ),
 * );
 * ```
 */
export function memberSearchStandIn(
  members: () => readonly StandInMember[] | undefined,
  asks: StandInSearchAsk[] = [],
  failure: StandInSearchFailure = {},
) {
  return {
    useMemberSearch: (
      _organizationId: string,
      query: string,
      options: Omit<StandInSearchAsk, 'query'> = {},
    ): MemberSearch => {
      asks.push({ query, ...options });
      const rows = members();
      const enabled = options.enabled ?? true;
      const typed = query.trim().toLowerCase();
      const found = (rows ?? [])
        .filter(
          (member) =>
            !(options.access === 'read' && member.role === 'disabled') &&
            (typed === '' ||
              (member.displayName ?? '').toLowerCase().includes(typed) ||
              (member.email ?? '').toLowerCase().includes(typed)),
        )
        .map(foundMember);
      const answered = enabled && rows !== undefined;
      const unavailable =
        enabled && rows === undefined && (failure.failed?.() ?? false);
      const stale =
        enabled && rows !== undefined && (failure.stale?.() ?? false);
      const failed = unavailable || stale;
      return {
        members: enabled ? found : [],
        answered,
        more: false,
        searching: false,
        unavailable,
        error: failed
          ? (failure.error?.() ?? new Error('search failed'))
          : undefined,
        stale,
        retrying: failed && (failure.retrying?.() ?? false),
        failureCount: failed ? 1 : 0,
        retry: () => failure.retry?.(),
      };
    },
  };
}
