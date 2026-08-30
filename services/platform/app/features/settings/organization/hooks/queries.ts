import * as z from 'zod';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useDebounce } from '@/app/hooks/use-debounce';
import type { ItemOf } from '@/app/lib/backend/contract';

export type Member = ItemOf<'members/queries:listByOrganization'>;

export type MemberPasskey = ItemOf<'two_factor/queries:listPasskeysForMember'>;

export function useMembers(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    'members/queries:listByOrganization',
    { organizationId },
  );

  return {
    members: data,
    isLoading,
  };
}

/**
 * Admin view of a member's registered passkeys (#1508). Pass `undefined`
 * to skip — the member edit dialog only fetches while it is open.
 */
export function useMemberPasskeys(memberId: string | undefined) {
  return useConvexQuery(
    'two_factor/queries:listPasskeysForMember',
    memberId ? { memberId } : 'skip',
  );
}

const emailSchema = z.string().email();

/**
 * Whether the given email already belongs to a user in the system. Used by the
 * Add member dialog to hide the password field for existing users — their
 * credentials are reused, so no new password is needed. The lookup is debounced
 * and only runs once the email is well-formed.
 */
export function useUserExistsByEmail(email: string): boolean {
  const debouncedEmail = useDebounce(email.trim(), 400);
  const isValidEmail = emailSchema.safeParse(debouncedEmail).success;
  const { data } = useConvexQuery(
    'members/queries:getUserIdByEmail',
    isValidEmail ? { email: debouncedEmail } : 'skip',
  );
  return typeof data === 'string' && data.length > 0;
}
