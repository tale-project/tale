import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectFilesTab } from './project-files-tab';

// Regression coverage for issue #2070: the Files tab exposed no way to
// download/open/preview an attached file. The fix wires the existing
// DocumentPreviewDialog into each row (a clickable title + an explicit preview
// IconButton) whenever the row carries a storage `fileId`. The preview dialog
// itself self-fetches via Convex, so it's stubbed here to a deterministic
// surface; what's asserted at the component tier is the same observable
// behaviour a user drives: a previewable row exposes the affordance and
// activating it opens the dialog for the right document, while a row without a
// stored file shows no affordance.

type DocFixture = {
  _id: Id<'documents'>;
  _creationTime: number;
  title?: string;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  folderId?: Id<'folders'>;
  indexed?: boolean;
  ragStatus: 'queued' | 'running' | 'completed' | 'failed' | null;
  createdBy?: string;
  sourceProvider?: string;
  record?: {
    state: 'draft' | 'in_review' | 'approved';
    version: number;
    currentFileId?: string;
    reviewerUserId?: string;
    reviewerName?: string;
  };
};

type FolderFixture = {
  _id: Id<'folders'>;
  name: string;
  parentId?: Id<'folders'>;
};

let documentsFixture: DocFixture[] = [];
let foldersFixture: FolderFixture[] = [];
let projectFixture: { canEdit: boolean } | null = { canEdit: true };

vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: projectFixture, isLoading: false }),
  useProjectDocuments: () => ({
    documents: documentsFixture,
    isLoading: false,
  }),
  useProjectFolders: () => ({
    folders: foldersFixture,
    isLoading: false,
  }),
}));

const detachMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../hooks/mutations', () => ({
  useDetachDocumentFromProject: () => ({
    mutateAsync: detachMutateAsync,
  }),
}));

const deleteFolderMutateAsync = vi.fn().mockResolvedValue(undefined);
const createFolderMutateAsync = vi.fn().mockResolvedValue('folder-new');
const markControlledMutateAsync = vi.fn().mockResolvedValue(null);
const openRevisionMutateAsync = vi.fn().mockResolvedValue({ version: 2 });
vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useDeleteFolder: () => ({ mutateAsync: deleteFolderMutateAsync }),
  useCreateFolder: () => ({ mutateAsync: createFolderMutateAsync }),
  useMarkDocumentControlled: () => ({
    mutateAsync: markControlledMutateAsync,
    isPending: false,
  }),
  useOpenRecordRevision: () => ({
    mutateAsync: openRevisionMutateAsync,
    isPending: false,
  }),
  useSubmitRecordForReview: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ approvalId: 'appr-1' }),
    isPending: false,
  }),
  useRespondToDocumentRecordReview: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/features/documents/hooks/queries', () => ({
  useDocumentByExternalItemId: () => ({
    data: undefined,
    isLoading: false,
  }),
  useDocumentVersions: () => ({
    data: undefined,
    isLoading: false,
  }),
  usePendingDocumentRecordReview: () => ({ data: undefined }),
}));

// The record menu consults legal holds per row; the submit dialog lists org
// members. Neither backend surface is under test here.
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: null }),
  useUploadPolicy: () => ({}),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [{ userId: 'u-reviewer', displayName: 'Riley', role: 'member' }],
  }),
}));

// FormDialog (inside ProjectCreateFolderDialog) reads the org id off the
// router params; the component tree here renders without a router.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

// The real preview dialog self-fetches the document/URL through Convex; stub it
// to a deterministic surface that records the document it was asked to open.
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: ({
    open,
    documentId,
    fileName,
  }: {
    open: boolean;
    documentId?: string;
    fileName?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label="Preview">
        <span data-testid="preview-doc-id">{documentId}</span>
        <span data-testid="preview-file-name">{fileName}</span>
      </div>
    ) : null,
}));

const PROJECT_ID = 'proj-1' as Id<'projects'>;

function renderTab(initialFolderId?: string, openCreateFolder?: boolean) {
  return render(
    <ProjectFilesTab
      organizationId="org-1"
      projectId={PROJECT_ID}
      initialFolderId={initialFolderId}
      openCreateFolder={openCreateFolder}
    />,
  );
}

function makeDoc(overrides: Partial<DocFixture> = {}): DocFixture {
  return {
    _id: 'doc-1' as Id<'documents'>,
    _creationTime: 0,
    title: 'Report.pdf',
    fileId: 'storage-1' as Id<'_storage'>,
    mimeType: 'application/pdf',
    ragStatus: 'completed',
    ...overrides,
  };
}

describe('ProjectFilesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documentsFixture = [];
    foldersFixture = [];
    projectFixture = { canEdit: true };
  });

  it('exposes a preview affordance on a row that has a stored file', () => {
    documentsFixture = [makeDoc()];
    renderTab();

    // The title row is an interactive treeitem (opens the preview) and
    // there's an explicit "Preview file" control.
    expect(
      screen.getByRole('treeitem', { name: 'Report.pdf' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Preview file' }),
    ).toBeInTheDocument();
  });

  it('opens the preview dialog for the row when the preview button is clicked', async () => {
    documentsFixture = [makeDoc()];
    const { user } = renderTab();

    expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Preview file' }));

    const dialog = await screen.findByRole('dialog', { name: 'Preview' });
    expect(within(dialog).getByTestId('preview-doc-id')).toHaveTextContent(
      'doc-1',
    );
    expect(within(dialog).getByTestId('preview-file-name')).toHaveTextContent(
      'Report.pdf',
    );
  });

  it('opens the preview when the file title is clicked', async () => {
    documentsFixture = [makeDoc()];
    const { user } = renderTab();

    await user.click(screen.getByRole('treeitem', { name: 'Report.pdf' }));

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Preview' }),
      ).toBeInTheDocument();
    });
  });

  it('shows no preview affordance for a row without a stored file', async () => {
    documentsFixture = [makeDoc({ fileId: undefined, title: 'Pending.pdf' })];
    renderTab();

    // The title renders as plain text, not a button, and no preview control.
    expect(screen.getByText('Pending.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pending.pdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview file' })).toBeNull();
  });

  // Regression coverage for issue #2546 — "Remove from project" silently
  // published the file to the org-wide Knowledge Hub. The confirmation must
  // name that consequence and the mutation must carry the explicit
  // destination.
  it('names the org-wide consequence in the detach confirmation and detaches with an explicit destination', async () => {
    documentsFixture = [makeDoc()];
    const { user } = renderTab();

    await user.click(
      screen.getByRole('button', { name: 'Remove from project' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Remove from project',
    });
    expect(
      within(dialog).getByText(/visible to everyone in the organization/i),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: 'Remove from project' }),
    );

    await waitFor(() => {
      expect(detachMutateAsync).toHaveBeenCalledWith({
        documentId: 'doc-1',
        destination: 'organization',
      });
    });
  });

  // Folder support: the tab renders an expand-in-place tree (shared
  // file-tree primitives) — folders expand to reveal their files, a header
  // action creates folders, and folder deletion warns about the cascade.
  it('renders a folder row and reveals its files on expand', async () => {
    foldersFixture = [{ _id: 'folder-1' as Id<'folders'>, name: 'Reports' }];
    documentsFixture = [
      makeDoc({
        _id: 'doc-in-folder' as Id<'documents'>,
        title: 'Q3.pdf',
        folderId: 'folder-1' as Id<'folders'>,
      }),
    ];
    const { user } = renderTab();

    const folderRow = screen.getByRole('treeitem', { name: 'Reports' });
    expect(folderRow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Q3.pdf' })).toBeNull();

    await user.click(folderRow);

    expect(screen.getByRole('treeitem', { name: 'Reports' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      await screen.findByRole('treeitem', { name: 'Q3.pdf' }),
    ).toBeInTheDocument();
  });

  it('opens the create-folder dialog from the header action', async () => {
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: 'New folder' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Create folder',
    });
    expect(within(dialog).getByLabelText(/folder name/i)).toBeInTheDocument();
  });

  it('opens the create-folder dialog from openCreateFolder deep-link', async () => {
    renderTab(undefined, true);

    const dialog = await screen.findByRole('dialog', {
      name: 'Create folder',
    });
    expect(within(dialog).getByLabelText(/folder name/i)).toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/dashboard/$id/projects/$projectId/files',
        search: {},
        replace: true,
      }),
    );
  });

  it('creates the folder scoped to the project', async () => {
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Create folder',
    });
    await user.type(within(dialog).getByLabelText(/folder name/i), 'Specs');
    await user.click(
      within(dialog).getByRole('button', { name: 'Create folder' }),
    );

    await waitFor(() => {
      expect(createFolderMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          name: 'Specs',
          projectId: PROJECT_ID,
          parentId: undefined,
        }),
      );
    });
  });

  it('warns about the cascade before deleting a folder and deletes on confirm', async () => {
    foldersFixture = [{ _id: 'folder-1' as Id<'folders'>, name: 'Reports' }];
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: 'Delete folder' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete folder',
    });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: 'Delete folder' }),
    );

    await waitFor(() => {
      expect(deleteFolderMutateAsync).toHaveBeenCalledWith({
        folderId: 'folder-1',
      });
    });
  });

  it('hides folder management affordances from read-only members', () => {
    foldersFixture = [{ _id: 'folder-1' as Id<'folders'>, name: 'Reports' }];
    projectFixture = { canEdit: false };
    renderTab();

    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull();
    // The tree itself still renders for readers.
    expect(
      screen.getByRole('treeitem', { name: 'Reports' }),
    ).toBeInTheDocument();
  });

  // Deep-link hydrate: `?folderId=` selects + expands the target (and
  // ancestors) once folders load; clicking a folder syncs the URL.
  it('hydrates selection and expands ancestors from initialFolderId', async () => {
    foldersFixture = [
      { _id: 'folder-root' as Id<'folders'>, name: 'Root' },
      {
        _id: 'folder-child' as Id<'folders'>,
        name: 'Child',
        parentId: 'folder-root' as Id<'folders'>,
      },
    ];
    documentsFixture = [
      makeDoc({
        _id: 'doc-nested' as Id<'documents'>,
        title: 'Nested.pdf',
        folderId: 'folder-child' as Id<'folders'>,
      }),
    ];
    renderTab('folder-child');

    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: 'Root' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByRole('treeitem', { name: 'Child' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
    expect(
      await screen.findByRole('treeitem', { name: 'Nested.pdf' }),
    ).toBeInTheDocument();
    // Selected folder is the upload target — drop-zone copy names it.
    expect(screen.getByText(/Add file to "Child"/i)).toBeInTheDocument();
  });

  it('syncs folderId into the URL when a folder is selected', async () => {
    foldersFixture = [{ _id: 'folder-1' as Id<'folders'>, name: 'Reports' }];
    const { user } = renderTab();

    await user.click(screen.getByRole('treeitem', { name: 'Reports' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/dashboard/$id/projects/$projectId/files',
        params: { id: 'org-1', projectId: PROJECT_ID },
        search: { folderId: 'folder-1' },
        replace: true,
      }),
    );
  });

  // Controlled records on project files — the same lifecycle the Knowledge
  // Hub row menu drives (useDocumentRecordActions), reachable from the tab
  // for project editors. #2947 shipped the backend project-aware; this is
  // the tab-side wiring.
  describe('controlled records', () => {
    const openRowMenu = async (
      user: ReturnType<typeof renderTab>['user'],
    ): Promise<void> => {
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
    };

    it('shows the record badge with version and state on the row', () => {
      documentsFixture = [
        makeDoc({
          record: {
            state: 'in_review',
            version: 3,
            currentFileId: 'storage-1',
            reviewerUserId: 'u-reviewer',
            reviewerName: 'Riley',
          },
        }),
      ];
      renderTab();

      expect(screen.getByText('v3 · In review')).toBeInTheDocument();
    });

    it('offers "Mark as controlled" on an uncontrolled upload row and calls the mutation', async () => {
      documentsFixture = [makeDoc({ sourceProvider: 'upload' })];
      const { user } = renderTab();

      await openRowMenu(user);
      await user.click(
        await screen.findByRole('menuitem', { name: 'Mark as controlled' }),
      );

      await waitFor(() => {
        expect(markControlledMutateAsync).toHaveBeenCalledWith({
          documentId: 'doc-1',
        });
      });
    });

    it('offers submit + replace on a draft record and opens the reviewer dialog', async () => {
      documentsFixture = [
        makeDoc({
          record: { state: 'draft', version: 1, currentFileId: 'storage-1' },
        }),
      ];
      const { user } = renderTab();

      await openRowMenu(user);
      expect(
        await screen.findByRole('menuitem', { name: 'Replace file' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'Mark as controlled' }),
      ).toBeNull();

      await user.click(
        screen.getByRole('menuitem', { name: 'Submit for review' }),
      );

      const dialog = await screen.findByRole('dialog', {
        name: 'Submit for review',
      });
      expect(within(dialog).getByText('Reviewer')).toBeInTheDocument();
    });

    it('offers only the review entry while a record is in review', async () => {
      documentsFixture = [
        makeDoc({
          record: {
            state: 'in_review',
            version: 1,
            currentFileId: 'storage-1',
          },
        }),
      ];
      const { user } = renderTab();

      await openRowMenu(user);
      expect(
        await screen.findByRole('menuitem', { name: 'Review record' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'Replace file' }),
      ).toBeNull();
      expect(
        screen.queryByRole('menuitem', { name: 'Submit for review' }),
      ).toBeNull();
    });

    it('opens the next revision from an approved record', async () => {
      documentsFixture = [
        makeDoc({
          record: { state: 'approved', version: 1, currentFileId: 'storage-1' },
        }),
      ];
      const { user } = renderTab();

      await openRowMenu(user);
      await user.click(
        await screen.findByRole('menuitem', { name: 'New revision' }),
      );

      await waitFor(() => {
        expect(openRevisionMutateAsync).toHaveBeenCalledWith({
          documentId: 'doc-1',
        });
      });
    });

    it('shows no record menu to viewers', () => {
      projectFixture = { canEdit: false };
      documentsFixture = [makeDoc({ sourceProvider: 'upload' })];
      renderTab();

      expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    });

    it('shows no record menu on a connector-sourced row without a record', () => {
      documentsFixture = [makeDoc({ sourceProvider: 'onedrive' })];
      renderTab();

      expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    });
  });
});
