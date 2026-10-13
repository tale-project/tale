// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { currentUserQuery } from './account';
import { memberContextQuery, type MemberContextView } from './org';
import { settingsWriteAdapters } from './settings';

/** A complete membership read, the shape the typed query key holds. */
function memberContext(
  organizationId: string,
  role: 'admin' | 'member',
): Exclude<MemberContextView, null> {
  return {
    status: 'ok',
    memberId: `member-${organizationId}`,
    organizationId,
    userId: 'user-1',
    role,
    createdAt: 0,
    displayName: 'Mia',
    isAdmin: role === 'admin',
  };
}

describe('account name adapter', () => {
  it('invalidates current-user and account-menu membership reads for the active organization', () => {
    const client = new QueryClient();
    const currentUserKey = currentUserQuery().queryKey;
    const memberContextKey = memberContextQuery('org-a').queryKey;
    const otherMemberContextKey = memberContextQuery('org-b').queryKey;
    client.setQueryData(currentUserKey, { userId: 'user-1', name: 'Mia' });
    client.setQueryData(memberContextKey, memberContext('org-a', 'admin'));
    client.setQueryData(
      otherMemberContextKey,
      memberContext('org-b', 'member'),
    );

    settingsWriteAdapters['users/mutations:updateUserName']?.invalidate?.(
      client,
      { name: 'Mia Rossi' },
      { organizationId: 'org-a' },
    );

    expect(client.getQueryState(currentUserKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(memberContextKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherMemberContextKey)?.isInvalidated).toBe(
      false,
    );
    client.clear();
  });
});
