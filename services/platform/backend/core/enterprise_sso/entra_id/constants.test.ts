import { describe, expect, it } from 'vitest';

import { withoutGraphFileScopes } from './constants';

describe('withoutGraphFileScopes', () => {
  it('removes short and fully-qualified Graph file scopes', () => {
    expect(
      withoutGraphFileScopes([
        'openid',
        'Files.Read',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Files.Read',
        'Sites.Read.All',
        'https://graph.microsoft.com/Sites.Read.All',
        'offline_access',
      ]),
    ).toEqual([
      'openid',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ]);
  });

  it('leaves identity scopes unchanged', () => {
    const scopes = [
      'openid',
      'email',
      'profile',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/GroupMember.Read.All',
    ];
    expect(withoutGraphFileScopes(scopes)).toEqual(scopes);
  });
});
