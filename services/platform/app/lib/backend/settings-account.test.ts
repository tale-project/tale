// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { currentUserQuery } from './account';
import { memberContextQuery } from './org';
import { settingsWriteAdapters } from './settings';

describe('account name adapter', () => {
  it('invalidates current-user and account-menu membership reads for the active organization', () => {
    const client = new QueryClient();
    const currentUserKey = currentUserQuery().queryKey;
    const memberContextKey = memberContextQuery('org-a').queryKey;
    const otherMemberContextKey = memberContextQuery('org-b').queryKey;
    client.setQueryData(currentUserKey, { name: 'Mia' });
    client.setQueryData(memberContextKey, {
      displayName: 'Mia',
      role: 'admin',
    });
    client.setQueryData(otherMemberContextKey, {
      displayName: 'Mia',
      role: 'member',
    });

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
