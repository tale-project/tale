// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

// A folder deleted from its row sat in the folder on screen, and the page
// used to jump to the Documents root after it, losing the place the reader
// was working in. The table, its columns, the row menu and the confirmation
// run for real; the reads, the write and the router are stubbed seams.

const { navigate, deleteFolder } = vi.hoisted(() => ({
  navigate: vi.fn(),
  deleteFolder: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
  useLocation: () => ({ pathname: '/dashboard/org-1/documents', search: {} }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@tale/ui/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-1' } }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: null }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
  useTeamNames: () => ({
    teams: [],
    nameOf: () => undefined,
    isLoading: false,
  }),
}));

// The reader is in "Contracts", which holds one subfolder, "Meetings".
vi.mock('../hooks/queries', () => ({
  useApproxDocumentCount: () => ({ data: 0 }),
  useFolder: () => ({ data: { _id: 'folder-contracts', name: 'Contracts' } }),
  useFolders: () => ({
    data: [
      {
        _id: 'folder-meetings',
        name: 'Meetings',
        _creationTime: 1_700_000_000_000,
        parentId: 'folder-contracts',
      },
    ],
  }),
  useListDocumentsPaginated: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
    error: null,
    retry: vi.fn(),
    isRetrying: false,
    unavailable: false,
    errorCount: 0,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useCancelOneDriveSync: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelGoogleDriveSync: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFolder: () => ({ mutateAsync: deleteFolder, isPending: false }),
  useMarkDocumentControlled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOpenRecordRevision: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/actions', () => ({
  useRetryRagIndexing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./documents-action-menu', () => ({
  DocumentsActionMenu: () => null,
}));

vi.mock('./document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

vi.mock('./breadcrumb-navigation', () => ({
  BreadcrumbNavigation: () => <nav aria-label="Folder path" />,
}));

import { DocumentsTable } from './documents-table';

function renderTable() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentsTable
        organizationId="org-1"
        currentFolderId="folder-contracts"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DocumentsTable — deleting a subfolder', () => {
  it('keeps the reader in the folder they were browsing', async () => {
    deleteFolder.mockResolvedValueOnce(null);
    const { user } = renderTable();

    const row = screen.getByRole('row', { name: /Meetings/ });
    await user.click(within(row).getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    navigate.mockClear();
    const dialog = await screen.findByRole('dialog', { name: 'Delete folder' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete folder' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(deleteFolder).toHaveBeenCalledWith({ folderId: 'folder-meetings' });
    expect(navigate).not.toHaveBeenCalled();
  });
});
