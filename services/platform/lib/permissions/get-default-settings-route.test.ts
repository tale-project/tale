import { describe, expect, it } from 'vitest';

import { getDefaultSettingsRoute } from './get-default-settings-route';

describe('getDefaultSettingsRoute', () => {
  it('redirects owner to organization settings', () => {
    expect(getDefaultSettingsRoute('owner')).toBe(
      '/dashboard/$id/settings/organization',
    );
  });

  it('redirects admin to organization settings', () => {
    expect(getDefaultSettingsRoute('admin')).toBe(
      '/dashboard/$id/settings/organization',
    );
  });

  it('redirects developer to integrations', () => {
    expect(getDefaultSettingsRoute('developer')).toBe(
      '/dashboard/$id/settings/integrations',
    );
  });

  it('redirects editor to account settings', () => {
    expect(getDefaultSettingsRoute('editor')).toBe(
      '/dashboard/$id/settings/account',
    );
  });

  it('redirects member to account settings', () => {
    expect(getDefaultSettingsRoute('member')).toBe(
      '/dashboard/$id/settings/account',
    );
  });

  it('redirects null role to account settings', () => {
    expect(getDefaultSettingsRoute(null)).toBe(
      '/dashboard/$id/settings/account',
    );
  });

  it('redirects unknown role to account settings', () => {
    expect(getDefaultSettingsRoute('disabled')).toBe(
      '/dashboard/$id/settings/account',
    );
  });
});
