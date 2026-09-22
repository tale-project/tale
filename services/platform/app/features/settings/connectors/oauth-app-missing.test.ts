import { describe, expect, it } from 'vitest';

import { oauthAppMissingExplainer } from './oauth-app-missing';

describe('oauthAppMissingExplainer', () => {
  // A deployment-only app (Slack) has no row in the organization's OAuth apps
  // card; the old copy sent admins to "the OAuth apps section below" and
  // members to an admin who could not configure it either (CONN-F15).
  it('names the deployment operator for an app no organization can register', () => {
    expect(
      oauthAppMissingExplainer({
        orgConfigurable: false,
        canManageOrgSettings: true,
      }),
    ).toBe('deployment');
    expect(
      oauthAppMissingExplainer({
        orgConfigurable: false,
        canManageOrgSettings: false,
      }),
    ).toBe('deployment');
  });

  it('points an admin at the OAuth apps card and a member at an admin otherwise', () => {
    expect(
      oauthAppMissingExplainer({
        orgConfigurable: true,
        canManageOrgSettings: true,
      }),
    ).toBe('admin');
    expect(
      oauthAppMissingExplainer({
        orgConfigurable: true,
        canManageOrgSettings: false,
      }),
    ).toBe('member');
  });
});
