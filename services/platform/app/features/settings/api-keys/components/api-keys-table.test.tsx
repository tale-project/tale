import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import type { ApiKey } from '../types';
import { ApiKeysTable } from './api-keys-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/use-api-keys', () => ({
  useRevokeApiKey: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/use-api-keys-table-config', () => ({
  useApiKeysTableConfig: () => ({
    columns: [
      {
        accessorKey: 'name',
        header: 'Name',
      },
    ],
    searchPlaceholder: 'Search keys',
    stickyLayout: false,
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
    suffix: 'wxyz',
    userId: 'user-1',
    enabled: true,
    expiresAt: null,
    createdAt: new Date(),
    lastRequest: null,
    ...overrides,
  };
}

describe('ApiKeysTable', () => {
  // Regression for #2381: rendered under `SettingsPage` (no bounded-height
  // ancestor) the table must let the settings page own the vertical scroll. It
  // must NOT emit the sticky-layout inner scroll container (`overscroll-contain`
  // + `overflow-auto`), which collapses to content height and swallows the
  // wheel over the table. The non-sticky frame uses `overflow-x-auto` instead.
  it('does not render the sticky wheel-trap scroll container', () => {
    const { container } = render(
      <ApiKeysTable apiKeys={[makeApiKey()]} organizationId="org-1" />,
    );

    expect(container.querySelector('.overscroll-contain')).toBeNull();
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

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
