import { describe, expect, it } from 'vitest';

import { mergeIntegrationListItem } from './merge-integration';

const fileItem = {
  slug: 'github',
  title: 'GitHub',
  authMethod: 'bearer_token',
  connectionConfig: { apiEndpoint: 'https://api.github.com', timeout: 30000 },
  iconUrl: 'data:image/svg+xml;base64,abc',
};

describe('mergeIntegrationListItem', () => {
  it('marks an integration connected when an active credential exists', () => {
    const merged = mergeIntegrationListItem(
      fileItem,
      {
        _id: 'cred_1',
        slug: 'github',
        isActive: true,
        status: 'active',
        authMethod: 'bearer_token',
      },
      'org_1',
    );
    expect(merged._id).toBe('cred_1');
    expect(merged.isActive).toBe(true);
    expect(merged.status).toBe('active');
    expect(merged.name).toBe('github');
    expect(merged.organizationId).toBe('org_1');
  });

  it('falls back to the slug as the stub id and "inactive" when no credential exists', () => {
    const merged = mergeIntegrationListItem(fileItem, undefined, 'org_1');
    // The uninstalled-stub convention `handleTestConnection` keys on.
    expect(merged._id).toBe('github');
    expect(merged.isActive).toBe(false);
    expect(merged.status).toBe('inactive');
  });

  it('lets the credential connectionConfig override the file definition', () => {
    const merged = mergeIntegrationListItem(
      fileItem,
      {
        slug: 'github',
        connectionConfig: { apiEndpoint: 'https://ghe.internal/api' },
      },
      'org_1',
    );
    expect(merged.connectionConfig).toEqual({
      apiEndpoint: 'https://ghe.internal/api',
      timeout: 30000,
    });
  });

  it('keeps an explicit file iconUrl', () => {
    const merged = mergeIntegrationListItem(fileItem, undefined, 'org_1');
    expect(merged.iconUrl).toBe('data:image/svg+xml;base64,abc');
  });
});
