import { useMemo } from 'react';

import type {
  AskedMemberLookup,
  LookedUpMember,
  MemberLookup,
  MemberLookupTarget,
} from '@/app/features/settings/organization/hooks/member-lookup';

/** A member as a test hands it to a screen. */
export interface StandInMember {
  userId: string;
  displayName?: string;
  email?: string;
  role?: LookedUpMember['role'];
}

function lookedUp(member: StandInMember, index: number): LookedUpMember {
  return {
    _id: `member-${member.userId}`,
    userId: member.userId,
    role: member.role ?? 'member',
    createdAt: index,
    displayName: member.displayName,
    email: member.email,
  };
}

/**
 * Stand-ins for the member lookup hooks (`member-lookup.ts`), for a test that
 * hands a screen its members instead of serving `GET /members/lookup`: the
 * lookup has answered for everyone in `members()` — and, while that is
 * undefined, for nobody yet. Whom the screen asks for is pushed onto
 * `asked`.
 *
 * Mock the module with it from a hoisted factory:
 *
 * ```ts
 * vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
 *   (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
 *     () => state.members,
 *   ),
 * );
 * ```
 */
export function memberLookupStandIn(
  members: () => readonly StandInMember[] | undefined,
  asked: MemberLookupTarget[] = [],
) {
  function useStandInLookup(): MemberLookup {
    const rows = members();
    return useMemo(
      () => ({
        members: (rows ?? []).map(lookedUp),
        answered: () => rows !== undefined,
      }),
      [rows],
    );
  }
  return {
    useMemberLookup: (
      _organizationId: string,
      targets: readonly MemberLookupTarget[],
    ): MemberLookup => {
      asked.push(...targets);
      return useStandInLookup();
    },
    useAskedMemberLookup: (_organizationId: string): AskedMemberLookup => {
      const lookup = useStandInLookup();
      return useMemo(
        () => ({
          ...lookup,
          pending: (target: MemberLookupTarget) => {
            asked.push(target);
            return !lookup.answered(target);
          },
        }),
        [lookup],
      );
    },
  };
}
