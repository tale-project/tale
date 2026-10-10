import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectFilesTab } from './project-files-tab';

// #3917: deleting the selected folder closes its confirmation at once and
// leaves the tree usable while the write is pending. The delete used to
// settle against the selection it started under, so a folder the reader
// picked in the meantime lost its selection and its `?folderId=`, and the
// next upload landed at the project root. The tab, its tree, the
// confirmation and the upload handler run for real; the reads, the writes,
// the blob door and the router are stubbed seams.

type FolderFixture = { _id: string; name: string; parentId?: string };

const ALPHA: FolderFixture = { _id: 'folder-a', name: 'Folder Alpha' };
const ALPHA_CHILD: FolderFixture = {
  _id: 'folder-a1',
  name: 'Alpha Child',
  parentId: 'folder-a',
};
const BRAVO: FolderFixture = { _id: 'folder-b', name: 'Folder Bravo' };
const CHARLIE: FolderFixture = { _id: 'folder-c', name: 'Folder Charlie' };

let foldersFixture: FolderFixture[] = [];

vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: { canEdit: true }, isLoading: false }),
  useProjectDocuments: () => ({ documents: [], isLoading: false }),
  useProjectFolders: () => ({ folders: foldersFixture, isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useDetachDocumentFromProject: () => ({ mutateAsync: vi.fn() }),
}));

const deleteFolderMutateAsync = vi.fn();
vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useDeleteDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFolder: () => ({ mutateAsync: deleteFolderMutateAsync }),
  useCreateFolder: () => ({ mutateAsync: vi.fn() }),
  useMarkDocumentControlled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOpenRecordRevision: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitRecordForReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRespondToDocumentRecordReview: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/features/documents/hooks/queries', () => ({
  useDocumentByExternalItemId: () => ({ data: undefined, isLoading: false }),
  useDocumentVersions: () => ({ data: undefined, isLoading: false }),
  usePendingDocumentRecordReview: () => ({ data: undefined }),
  useEligibleDocumentReviewerIds: () => ({ data: [] }),
  useLastDocumentRecordReview: () => ({ data: undefined }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: null }),
  useUploadPolicy: () => ({}),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The upload's two writes: the blob door's address, then the document row
// whose `folderId` is the destination under test.
const createDocumentFromUpload = vi.fn();
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string) => ({
    mutateAsync:
      name === 'documents/mutations:createDocumentFromUpload'
        ? createDocumentFromUpload
        : vi.fn().mockResolvedValue('https://blob.test/upload'),
  }),
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));

vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

/** A delete the test answers when it chooses. */
function heldDelete() {
  let succeed = () => {};
  let fail = (_error: unknown) => {};
  const answer = new Promise<void>((resolve, reject) => {
    succeed = () => resolve();
    fail = reject;
  });
  deleteFolderMutateAsync.mockReturnValueOnce(answer);
  return {
    succeed: () => act(async () => succeed()),
    fail: (error: unknown) => act(async () => fail(error)),
  };
}

function renderTab() {
  let projectId = 'project-a';
  const tab = () => (
    <ProjectFilesTab organizationId="org-1" projectId={projectId} />
  );
  const rendered = render(tab());
  return {
    ...rendered,
    /** The folder read answers again, as the delete's invalidation does. */
    refreshFolders: (folders: FolderFixture[]) => {
      foldersFixture = folders;
      rendered.rerender(tab());
    },
    /** Another project in the same mounted tab: the tab's own contract (the
     * Files route keys the tab by project, #3918). */
    showProject: (id: string, folders: FolderFixture[]) => {
      projectId = id;
      foldersFixture = folders;
      rendered.rerender(tab());
    },
  };
}

const folderRow = (name: string) => screen.getByRole('button', { name });
const selectedRows = () =>
  screen
    .queryAllByRole('button')
    .filter((button) => button.getAttribute('aria-current') === 'true');
/** The Files URL the tab last wrote (`replace`), as its search params. */
const lastSearch = () => navigate.mock.lastCall?.[0]?.search;

async function confirmDelete(
  user: ReturnType<typeof renderTab>['user'],
  name: string,
) {
  const row = folderRow(name).closest('li');
  if (!row) throw new Error(`no tree row for ${name}`);
  // The row's own action comes first; an expanded row also holds its
  // subfolders' actions.
  const [deleteAction] = within(row).getAllByRole('button', {
    name: 'Delete folder',
  });
  if (!deleteAction) throw new Error(`no Delete folder on ${name}`);
  await user.click(deleteAction);
  const dialog = await screen.findByRole('dialog', { name: 'Delete folder' });
  await user.click(
    within(dialog).getByRole('button', { name: 'Delete folder' }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

async function uploadOneFile(user: ReturnType<typeof renderTab>['user']) {
  const input = document.getElementById('project-files-upload');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  await user.upload(
    input,
    new File(['synthetic'], 'new-upload.txt', { type: 'text/plain' }),
  );
  await waitFor(() => {
    expect(createDocumentFromUpload).toHaveBeenCalledTimes(1);
  });
  return createDocumentFromUpload.mock.calls[0]?.[0];
}

beforeEach(() => {
  foldersFixture = [ALPHA, BRAVO];
  createDocumentFromUpload.mockResolvedValue('doc-new');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ storageId: 'storage-new' }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ProjectFilesTab — a folder delete that answers late', () => {
  it('keeps a folder picked while the delete was pending as the upload target', async () => {
    const remove = heldDelete();
    const { user, refreshFolders } = renderTab();

    await user.click(folderRow('Folder Alpha'));
    await confirmDelete(user, 'Folder Alpha');
    expect(deleteFolderMutateAsync).toHaveBeenCalledWith({
      folderId: 'folder-a',
    });

    // The tree stays usable while the write is pending.
    await user.click(folderRow('Folder Bravo'));
    expect(folderRow('Folder Bravo')).toHaveAttribute('aria-current', 'true');
    expect(lastSearch()).toEqual({ folderId: 'folder-b' });

    await remove.succeed();
    refreshFolders([BRAVO]);

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Folder deleted', variant: 'success' }),
    );
    expect(folderRow('Folder Bravo')).toHaveAttribute('aria-current', 'true');
    expect(lastSearch()).toEqual({ folderId: 'folder-b' });
    expect(screen.getByText(/Add file to "Folder Bravo"/)).toBeInTheDocument();
    // The tree is what the answer changed. (jsdom applies no CSS, so axe
    // would judge the drop zone's hidden file input visible.)
    await checkAccessibility(
      screen.getByRole('list', { name: 'Project files' }),
    );

    expect(await uploadOneFile(user)).toEqual(
      expect.objectContaining({
        projectId: 'project-a',
        fileName: 'new-upload.txt',
        folderId: 'folder-b',
      }),
    );
  });

  it('clears the deleted folder it still has selected, so the next pick is the target', async () => {
    const remove = heldDelete();
    const { user, refreshFolders } = renderTab();

    await user.click(folderRow('Folder Alpha'));
    await confirmDelete(user, 'Folder Alpha');
    await remove.succeed();
    refreshFolders([BRAVO]);

    expect(selectedRows()).toEqual([]);
    expect(lastSearch()).toEqual({});

    await user.click(folderRow('Folder Bravo'));
    expect(await uploadOneFile(user)).toEqual(
      expect.objectContaining({ folderId: 'folder-b' }),
    );
  });

  it('clears a selected folder inside the deleted one, so nothing lands in it', async () => {
    foldersFixture = [ALPHA, ALPHA_CHILD, BRAVO];
    const remove = heldDelete();
    const { user, refreshFolders } = renderTab();

    // Selecting Alpha expands it; then the reader picks its subfolder.
    await user.click(folderRow('Folder Alpha'));
    await user.click(folderRow('Alpha Child'));
    expect(folderRow('Alpha Child')).toHaveAttribute('aria-current', 'true');

    await confirmDelete(user, 'Folder Alpha');
    await remove.succeed();
    refreshFolders([BRAVO]);

    expect(selectedRows()).toEqual([]);
    expect(lastSearch()).toEqual({});
    const upload = await uploadOneFile(user);
    expect(upload).toEqual(expect.objectContaining({ projectId: 'project-a' }));
    expect(upload?.folderId).toBeUndefined();
  });

  it('keeps a selection the delete never touched', async () => {
    const remove = heldDelete();
    const { user, refreshFolders } = renderTab();

    await user.click(folderRow('Folder Bravo'));
    await confirmDelete(user, 'Folder Alpha');
    await remove.succeed();
    refreshFolders([BRAVO]);

    expect(folderRow('Folder Bravo')).toHaveAttribute('aria-current', 'true');
    expect(lastSearch()).toEqual({ folderId: 'folder-b' });
    expect(await uploadOneFile(user)).toEqual(
      expect.objectContaining({ folderId: 'folder-b' }),
    );
  });

  it('keeps the newer pick and says so when the delete is refused', async () => {
    const remove = heldDelete();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = renderTab();

    await user.click(folderRow('Folder Alpha'));
    await confirmDelete(user, 'Folder Alpha');
    await user.click(folderRow('Folder Bravo'));
    await remove.fail(new Error('synthetic refusal'));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't delete the folder",
        variant: 'destructive',
      }),
    );
    expect(folderRow('Folder Alpha')).toBeInTheDocument();
    expect(folderRow('Folder Bravo')).toHaveAttribute('aria-current', 'true');
    expect(lastSearch()).toEqual({ folderId: 'folder-b' });
    expect(await uploadOneFile(user)).toEqual(
      expect.objectContaining({ folderId: 'folder-b' }),
    );
  });

  it('clears the deleted folder in the project the reader switched to', async () => {
    const remove = heldDelete();
    const { user, showProject } = renderTab();

    await user.click(folderRow('Folder Alpha'));
    await confirmDelete(user, 'Folder Alpha');
    showProject('project-b', [CHARLIE]);
    navigate.mockClear();

    await remove.succeed();

    // The address names the project on screen, never the one the delete
    // started in.
    expect(navigate).toHaveBeenCalled();
    for (const [call] of navigate.mock.calls) {
      expect(call).toEqual(
        expect.objectContaining({
          params: { id: 'org-1', projectId: 'project-b' },
          search: {},
        }),
      );
    }
    const upload = await uploadOneFile(user);
    expect(upload).toEqual(expect.objectContaining({ projectId: 'project-b' }));
    expect(upload?.folderId).toBeUndefined();
  });

  it('leaves the address alone when the reader has left the tab', async () => {
    const remove = heldDelete();
    const { user, unmount } = renderTab();

    await user.click(folderRow('Folder Alpha'));
    await confirmDelete(user, 'Folder Alpha');
    unmount();
    navigate.mockClear();

    await remove.succeed();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Folder deleted', variant: 'success' }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
