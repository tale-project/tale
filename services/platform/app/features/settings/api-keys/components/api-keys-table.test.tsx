import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { ApiKey } from '../types';
import { ApiKeysTable } from './api-keys-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/use-api-keys-table-config', () => ({
  useApiKeysTableConfig: () => ({
    columns: [
      {
        accessorKey: 'name',
        header: 'Name',
      },
    ],
    searchPlaceholder: 'Search keys...',
    stickyLayout: true,
    pageSize: 20,
    infiniteScroll: false,
  }),
}));

vi.mock('./api-keys-action-menu', () => ({
  ApiKeysActionMenu: () => <button type="button">Create key</button>,
}));

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    name: 'Test Key',
    start: 'tale_abc',
    prefix: 'tale_',
    userId: 'user-1',
    enabled: true,
    expiresAt: null,
    createdAt: new Date(),
    lastRequest: null,
    ...overrides,
  };
}

describe('ApiKeysTable', () => {
  describe('accessibility', () => {
    it('passes axe audit with keys', async () => {
      const { container } = render(
        <ApiKeysTable
          apiKeys={[
            makeApiKey(),
            makeApiKey({ id: 'key-2', name: 'Other Key' }),
          ]}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when empty', async () => {
      const { container } = render(
        <ApiKeysTable apiKeys={[]} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when loading', async () => {
      const { container } = render(
        <ApiKeysTable apiKeys={undefined} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
