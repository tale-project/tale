import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

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

// The dialog's own form is covered by `api-key-create-dialog.test.tsx`; here
// it only has to say whether the table opened it.
vi.mock('./api-key-create-dialog', () => ({
  ApiKeyCreateDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Create API key dialog" /> : null,
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

  // The create button is DataTable's standard `addAction`. This table has no
  // search box, so while there are no keys the button sits in the empty state
  // — and only there: the empty state used to carry a second, hand-made
  // Create button under the toolbar's own.
  describe('create action', () => {
    it('withholds the opener until an initially unknown list is known empty', () => {
      const { rerender } = render(
        <ApiKeysTable apiKeys={undefined} organizationId="org-1" />,
      );
      expect(
        screen.queryByRole('button', { name: 'Create API key' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'No API keys yet' }),
      ).not.toBeInTheDocument();

      rerender(<ApiKeysTable apiKeys={[]} organizationId="org-1" />);
      const emptyTitle = screen.getByRole('heading', {
        name: 'No API keys yet',
      });
      expect(
        within(emptyTitle.parentElement as HTMLElement).getByRole('button', {
          name: 'Create API key',
        }),
      ).toBeEnabled();
    });

    it('offers retry after a failed cold read, then creates from the empty state', async () => {
      const retry = vi.fn();
      const { user, rerender } = render(
        <ApiKeysTable
          apiKeys={undefined}
          organizationId="org-1"
          error={new Error('Initial list unavailable')}
          onRetry={retry}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'Create API key' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledTimes(1);

      rerender(<ApiKeysTable apiKeys={undefined} organizationId="org-1" />);
      expect(
        screen.queryByRole('button', { name: 'Create API key' }),
      ).not.toBeInTheDocument();
      rerender(<ApiKeysTable apiKeys={[]} organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Create API key' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('keeps the known-empty opener mounted when its refetch fails', () => {
      const { rerender } = render(
        <ApiKeysTable apiKeys={[]} organizationId="org-1" />,
      );
      const opener = screen.getByRole('button', { name: 'Create API key' });
      opener.focus();

      rerender(
        <ApiKeysTable
          apiKeys={[]}
          organizationId="org-1"
          error={new Error('Refresh after creation failed')}
          onRetry={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'Create API key' })).toBe(
        opener,
      );
      expect(opener).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it.each([
      ['with keys', [makeApiKey()]],
      ['when empty', []],
    ])(
      'offers one create button %s, and it opens the dialog',
      async (_, apiKeys) => {
        const { user } = render(
          <ApiKeysTable apiKeys={apiKeys} organizationId="org-1" />,
        );

        const create = screen.getAllByRole('button', {
          name: 'Create API key',
        });
        expect(create).toHaveLength(1);
        expect(
          screen.queryByRole('dialog', { name: 'Create API key dialog' }),
        ).toBeNull();

        await user.click(create[0] as HTMLElement);

        expect(
          screen.getByRole('dialog', { name: 'Create API key dialog' }),
        ).toBeInTheDocument();
      },
    );

    it('puts the create button in the empty state while there are no keys', () => {
      render(<ApiKeysTable apiKeys={[]} organizationId="org-1" />);

      const emptyTitle = screen.getByRole('heading', {
        name: 'No API keys yet',
      });
      const emptyState = emptyTitle.parentElement as HTMLElement;
      // Only there: no toolbar button above the empty table as well.
      expect(screen.getAllByRole('button', { name: 'Create API key' })).toEqual(
        [within(emptyState).getByRole('button', { name: 'Create API key' })],
      );
    });

    it('offers no create to a holder whose right lapsed, yet lists and revokes their keys', () => {
      render(
        <ApiKeysTable
          apiKeys={[makeApiKey({ name: 'Mirror worker' })]}
          organizationId="org-1"
          canCreate={false}
        />,
      );

      expect(screen.getByText('Mirror worker')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Create API key' }),
      ).toBeNull();
    });

    it('says who may create one when a holder whose right lapsed has none left', () => {
      render(
        <ApiKeysTable apiKeys={[]} organizationId="org-1" canCreate={false} />,
      );

      expect(
        screen.getByText(
          'Creating a key takes the Owner, Admin or Developer role, or a competence an Admin grants for one.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Create API key' }),
      ).toBeNull();
    });

    it.each([
      ['with keys', [makeApiKey()]],
      ['when empty', []],
    ])('links the API docs below the table %s', (_, apiKeys) => {
      render(<ApiKeysTable apiKeys={apiKeys} organizationId="org-1" />);

      const links = screen.getAllByRole('link', { name: 'API docs' });
      expect(links).toHaveLength(1);
      const link = links[0] as HTMLElement;
      // Outside the table — so outside the empty state, where it used to sit —
      // and after it.
      const table = screen.getByRole('table');
      expect(table).not.toContainElement(link);
      expect(
        table.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
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
